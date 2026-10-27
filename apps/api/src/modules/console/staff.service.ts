import { Inject, Injectable } from '@nestjs/common';
import {
  AppError,
  type InviteStaffBody,
  maskEmail,
  newId,
  passwordWords,
  passwordWordsIssue,
  PLATFORM_ROLE_PERMISSIONS,
  type PlatformRoleKey,
  type StaffClaims,
  type StaffPasswordBody,
  type StaffResult,
  type StaffSession,
} from '@thelamp/shared';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Config } from '../../config';
import { platformSessions, platformUsers } from '../../db/schema/directory';
import { type StaffAccess, StaffResolver } from '../../platform/auth';
import { ColumnCipher } from '../../platform/column-cipher';
import { EndedSessions } from '../../platform/ended-sessions';
import { type RateLimit, RateLimiter } from '../../platform/rate-limit';
import { SecurityLog } from '../../platform/security-log';
import { CONFIG } from '../../platform/tokens';
import { DirectoryDatabase, type DirectoryTx } from '../directory/directory.database';
import { digest, newSecret } from '../directory/secrets';
import { SigningKey } from '../directory/signing-key';
import { BreachedPasswords } from '../../platform/breached-passwords';
import { DECOY_HASH, hashPassword, needsRehash, verifyPassword } from '../../platform/passwords';
import { PlatformAudit } from '../directory/platform-audit';
import { matchTotp, newTotpSecret, otpauthUri } from '../../platform/totp';

/** Console sessions last 12 hours, a working day, and rotate on every refresh. */
export const STAFF_SESSION_HOURS = 12;
/** An invitation's setup link works for 72 hours. */
export const SETUP_HOURS = 72;
/**
 * Ten wrong tries lock the account for 15 minutes. A locked account answers as wrong details do,
 * so the lock says nothing about whether an email is known (decision D101).
 */
export const LOCK = { after: 10, minutes: 15 } as const;

export const STAFF_LIMITS = {
  signInsPerAddress: { name: 'staff-sign-in-ip', max: 20, windowSeconds: 900 },
  signInsPerEmail: { name: 'staff-sign-in-email', max: 10, windowSeconds: 900 },
  setupsPerAddress: { name: 'staff-setup-ip', max: 20, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimit>;

type StaffRow = typeof platformUsers.$inferSelect;

/** One answer for every wrong email, password or code, so none says which part was wrong. */
const refused = () =>
  new AppError('UNAUTHENTICATED', 'Check your email, password and authenticator code.');
const wrongCurrent = () =>
  new AppError('VALIDATION', 'Check the highlighted fields.', [
    { path: 'currentPassword', issue: 'Check your current password and authenticator code' },
  ]);
const setupRefused = () =>
  new AppError('UNAUTHENTICATED', 'This setup link has expired or been used. Ask for a new one.');

/**
 * The vendor's staff (module M22, decision D88): invitations with a one-time setup link, a
 * password and an authenticator to sign in, console sessions with rotating refresh tokens, and
 * the per-request check that a staff member is still active at their token's revision.
 */
@Injectable()
export class StaffService extends StaffResolver {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly keys: SigningKey,
    private readonly cipher: ColumnCipher,
    private readonly limiter: RateLimiter,
    private readonly audit: PlatformAudit,
    private readonly breached: BreachedPasswords,
    private readonly security: SecurityLog,
    private readonly ended: EndedSessions,
    @Inject(CONFIG) private readonly config: Config,
  ) {
    super();
  }

  /**
   * Invites someone, or invites them again when they never finished: the setup link is returned
   * once and kept only as a hash. `by` is null for the command that invites the first admin.
   */
  async invite(
    body: InviteStaffBody,
    by: StaffAccess | null,
  ): Promise<{ staff: StaffResult; setupUrl: string }> {
    const token = newSecret();
    const expires = new Date(Date.now() + SETUP_HOURS * 3_600_000);
    const row = await this.database.db.transaction(async (tx) => {
      // The same ID again invites the same person again, with a new link.
      const [same] = await tx
        .select()
        .from(platformUsers)
        .where(eq(platformUsers.id, body.id))
        .for('update');
      if (same && same.email.toLowerCase() !== body.email.toLowerCase()) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'This ID was used for someone else.');
      }
      if (same && same.status !== 'invited') {
        throw new AppError('CONFLICT', 'This person has already set up their account.');
      }
      if (!same) {
        const [taken] = await tx
          .select({ id: platformUsers.id })
          .from(platformUsers)
          .where(sql`lower(${platformUsers.email}) = lower(${body.email})`);
        if (taken) {
          throw new AppError('CONFLICT', 'Someone already has this email.', [
            { path: 'email', issue: 'Already used by another staff member' },
          ]);
        }
      }
      const [saved] = await tx
        .insert(platformUsers)
        .values({
          id: body.id,
          email: body.email,
          name: body.name,
          role: body.role,
          setupTokenHash: digest(token),
          setupExpiresAt: expires,
        })
        .onConflictDoUpdate({
          target: platformUsers.id,
          set: { setupTokenHash: digest(token), setupExpiresAt: expires, name: body.name },
        })
        .returning();
      await this.audit.record(tx, by, 'staff.invited', 'platform_user', saved!.id, {
        email: body.email,
        role: body.role,
      });
      return saved!;
    });
    return { staff: this.result(row), setupUrl: `${this.config.CONSOLE_URL}/setup#${token}` };
  }

  /**
   * The first half of setting up: the password, and a new authenticator secret shown once. It
   * works again until a code confirms the authenticator, so a lost QR code is no dead end.
   */
  async setUp(
    token: string,
    password: string,
    ip: string,
  ): Promise<{ secret: string; uri: string }> {
    await this.limiter.hit(STAFF_LIMITS.setupsPerAddress, ip);
    const row = await this.byToken(this.database.db, token);
    await this.checkNew(password, row, 'password');
    const secret = newTotpSecret();
    await this.database.db
      .update(platformUsers)
      .set({
        passwordHash: await hashPassword(password),
        totpSecret: this.cipher.seal(secret, this.where(row.id)),
        totpConfirmedAt: null,
      })
      .where(eq(platformUsers.id, row.id));
    return { secret, uri: otpauthUri(this.config.PRODUCT_NAME, row.email, secret) };
  }

  /** The second half: a code from the authenticator makes the account active. */
  async confirm(token: string, code: string, ip: string): Promise<StaffResult> {
    await this.limiter.hit(STAFF_LIMITS.setupsPerAddress, ip);
    return this.database.db.transaction(async (tx) => {
      const row = await this.byToken(tx, token);
      if (!row.passwordHash || !row.totpSecret) throw setupRefused();
      const step = matchTotp(this.cipher.open(row.totpSecret, this.where(row.id)), code, null);
      if (step === null) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: 'code', issue: 'That code is not right; check the time on your phone' },
        ]);
      }
      const [saved] = await tx
        .update(platformUsers)
        .set({
          status: 'active',
          totpConfirmedAt: new Date(),
          totpLastStep: step,
          setupTokenHash: null,
          setupExpiresAt: null,
        })
        .where(eq(platformUsers.id, row.id))
        .returning();
      await this.audit.record(tx, null, 'staff.set_up', 'platform_user', row.id, {}, ip);
      return this.result(saved!);
    });
  }

  /**
   * Signs in with the email, password and a fresh code; the session's refresh token goes back.
   * The row is locked while the attempt is judged, so wrong tries are counted and a code is
   * spent exactly once however many attempts arrive together (decision D101).
   */
  async signIn(
    email: string,
    password: string,
    code: string,
    ip: string,
  ): Promise<{ session: StaffSession; refreshToken: string }> {
    await this.limiter.hit(STAFF_LIMITS.signInsPerAddress, ip);
    await this.limiter.hit(STAFF_LIMITS.signInsPerEmail, email.toLowerCase());
    const signedIn = await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(platformUsers)
        .where(sql`lower(${platformUsers.email}) = lower(${email})`)
        .for('update');
      const judged = await this.attempt(tx, row, password, code);
      if (!row || 'refused' in judged) {
        this.security.record({
          event: 'sign_in_failed',
          plane: 'directory',
          method: 'password',
          subject: maskEmail(email),
          reason: 'refused' in judged ? judged.refused : 'unknown_email',
        });
        return null;
      }
      const { step } = judged;
      // A hash made at an older cost is made again now, while the password is at hand.
      const rehash =
        row.passwordHash && needsRehash(row.passwordHash)
          ? { passwordHash: await hashPassword(password) }
          : {};
      const [saved] = await tx
        .update(platformUsers)
        .set({ ...rehash, totpLastStep: step, lastSignInAt: new Date() })
        .where(eq(platformUsers.id, row.id))
        .returning();
      await this.audit.record(tx, null, 'staff.signed_in', 'platform_user', row.id, {}, ip);
      this.security.record({
        event: 'signed_in',
        plane: 'directory',
        actor: `staff:${row.id}`,
        method: 'password',
        factors: ['password', 'authenticator'],
      });
      return this.issue(tx, saved!, newId());
    });
    if (!signedIn) throw refused();
    return signedIn;
  }

  /**
   * Changes the signed-in staff member's password, given the current one and a fresh code
   * (decision D101). Every session ends, and the new one goes back.
   */
  async changePassword(
    staff: StaffAccess,
    body: StaffPasswordBody,
    ip: string,
  ): Promise<{ session: StaffSession; refreshToken: string }> {
    await this.limiter.hit(STAFF_LIMITS.signInsPerAddress, ip);
    const [current] = await this.database.db
      .select()
      .from(platformUsers)
      .where(eq(platformUsers.id, staff.staffId));
    if (!current) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
    // Checked before the row is locked, as the breach check goes out to the internet.
    await this.checkNew(body.newPassword, current, 'newPassword');
    const changed = await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(platformUsers)
        .where(eq(platformUsers.id, staff.staffId))
        .for('update');
      const judged = await this.attempt(tx, row, body.currentPassword, body.code);
      if (!row || 'refused' in judged) {
        this.security.record({
          event: 'reauthentication_failed',
          plane: 'directory',
          method: 'password',
          reason: 'refused' in judged ? judged.refused : 'unknown_staff',
        });
        return 'wrong' as const;
      }
      const { step } = judged;
      if (body.newPassword === body.currentPassword) return 'same' as const;
      const [saved] = await tx
        .update(platformUsers)
        .set({
          passwordHash: await hashPassword(body.newPassword),
          totpLastStep: step,
          authRevision: sql`${platformUsers.authRevision} + 1`,
        })
        .where(eq(platformUsers.id, row.id))
        .returning();
      await this.endSessions(tx, row.id);
      await this.audit.record(tx, staff, 'staff.password_changed', 'platform_user', row.id, {}, ip);
      return this.issue(tx, saved!, newId());
    });
    if (changed === 'wrong') throw wrongCurrent();
    if (changed === 'same') {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', [
        { path: 'newPassword', issue: 'Choose a password other than your current one' },
      ]);
    }
    return changed;
  }

  /**
   * Starts someone's sign-in again when they lost their password or authenticator (decision
   * D101): both are removed, their sessions end, and a new setup link is returned once. Nobody
   * resets themselves.
   */
  async reset(by: StaffAccess, id: string): Promise<{ staff: StaffResult; setupUrl: string }> {
    if (by.staffId === id) {
      throw new AppError('FORBIDDEN', 'Ask another platform admin to reset your sign-in.');
    }
    const token = newSecret();
    const row = await this.database.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ status: platformUsers.status })
        .from(platformUsers)
        .where(eq(platformUsers.id, id))
        .for('update');
      if (!found) throw new AppError('NOT_FOUND', 'There is no such staff member.');
      if (found.status === 'disabled') {
        throw new AppError('CONFLICT', 'This account is disabled for good.');
      }
      const [saved] = await tx
        .update(platformUsers)
        .set({
          status: 'invited',
          passwordHash: null,
          totpSecret: null,
          totpConfirmedAt: null,
          totpLastStep: null,
          failedSignIns: 0,
          lockedUntil: null,
          setupTokenHash: digest(token),
          setupExpiresAt: new Date(Date.now() + SETUP_HOURS * 3_600_000),
          authRevision: sql`${platformUsers.authRevision} + 1`,
        })
        .where(eq(platformUsers.id, id))
        .returning();
      await this.endSessions(tx, id);
      await this.audit.record(tx, by, 'staff.reset', 'platform_user', id, {});
      return saved!;
    });
    return { staff: this.result(row), setupUrl: `${this.config.CONSOLE_URL}/setup#${token}` };
  }

  /** Spends a refresh token for a new session; a spent one ends its whole family. */
  async refresh(refreshToken: string): Promise<{ session: StaffSession; refreshToken: string }> {
    const result = await this.database.db.transaction(async (tx) => {
      const [token] = await tx
        .select()
        .from(platformSessions)
        .where(eq(platformSessions.tokenHash, digest(refreshToken)))
        .for('update');
      if (!token) return null;
      if (token.revokedAt) {
        // Only a copy is presented twice (decision D101).
        this.security.record({
          event: 'session_reused',
          plane: 'directory',
          actor: `staff:${token.platformUserId}`,
        });
      }
      const [row] = await tx
        .select()
        .from(platformUsers)
        .where(eq(platformUsers.id, token.platformUserId));
      if (
        token.revokedAt ||
        token.expiresAt.getTime() <= Date.now() ||
        !row ||
        row.status !== 'active' ||
        token.authRevision !== row.authRevision
      ) {
        await this.endFamily(tx, token.familyId);
        return null;
      }
      await tx
        .update(platformSessions)
        .set({ revokedAt: new Date() })
        .where(eq(platformSessions.id, token.id));
      return this.issue(tx, row, token.familyId);
    });
    if (!result) throw new AppError('SESSION_REVOKED', 'Sign in again.');
    return result;
  }

  async signOut(refreshToken: string): Promise<void> {
    const [token] = await this.database.db
      .select()
      .from(platformSessions)
      .where(eq(platformSessions.tokenHash, digest(refreshToken)));
    if (token) await this.endFamily(this.database.db, token.familyId);
  }

  async me(staff: StaffAccess): Promise<StaffResult> {
    const [row] = await this.database.db
      .select()
      .from(platformUsers)
      .where(eq(platformUsers.id, staff.staffId));
    if (!row) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
    return this.result(row);
  }

  async list(): Promise<StaffResult[]> {
    const rows = await this.database.db
      .select()
      .from(platformUsers)
      .orderBy(asc(sql`lower(${platformUsers.email})`));
    return rows.map((row) => this.result(row));
  }

  /** Disables someone for good, ending their sessions. Nobody disables themselves. */
  async disable(by: StaffAccess, id: string): Promise<StaffResult> {
    if (by.staffId === id) {
      throw new AppError('FORBIDDEN', 'Ask another platform admin to disable your account.');
    }
    return this.database.db.transaction(async (tx) => {
      const [saved] = await tx
        .update(platformUsers)
        .set({
          status: 'disabled',
          setupTokenHash: null,
          authRevision: sql`${platformUsers.authRevision} + 1`,
        })
        .where(eq(platformUsers.id, id))
        .returning();
      if (!saved) throw new AppError('NOT_FOUND', 'There is no such staff member.');
      await this.endSessions(tx, id);
      await this.audit.record(tx, by, 'staff.disabled', 'platform_user', id, {});
      return this.result(saved);
    });
  }

  /** The guard's check on every console request. */
  async resolve(claims: StaffClaims, ip?: string): Promise<StaffAccess> {
    const [row] = await this.database.db
      .select({
        status: platformUsers.status,
        role: platformUsers.role,
        authRevision: platformUsers.authRevision,
      })
      .from(platformUsers)
      .where(eq(platformUsers.id, claims.sub));
    if (!row || row.status !== 'active' || row.authRevision !== claims.rev) {
      throw new AppError('SESSION_REVOKED', 'Sign in again.');
    }
    return {
      staffId: claims.sub,
      role: row.role,
      permissions: new Set(PLATFORM_ROLE_PERMISSIONS[row.role]),
      ...(ip ? { ip } : {}),
    };
  }

  private async byToken(db: DirectoryTx | DirectoryDatabase['db'], token: string) {
    const [row] = await db
      .select()
      .from(platformUsers)
      .where(
        and(
          eq(platformUsers.setupTokenHash, digest(token)),
          eq(platformUsers.status, 'invited'),
          gt(platformUsers.setupExpiresAt, new Date()),
        ),
      );
    if (!row) throw setupRefused();
    return row;
  }

  private async issue(
    tx: DirectoryTx,
    row: StaffRow,
    familyId: string,
  ): Promise<{ session: StaffSession; refreshToken: string }> {
    const refreshToken = newSecret();
    await tx.insert(platformSessions).values({
      id: newId(),
      platformUserId: row.id,
      tokenHash: digest(refreshToken),
      familyId,
      authRevision: row.authRevision,
      expiresAt: new Date(Date.now() + STAFF_SESSION_HOURS * 3_600_000),
    });
    const { token, expiresAt } = await this.keys.signStaff({
      staffId: row.id,
      role: row.role,
      revision: row.authRevision,
      sessionId: familyId,
    });
    return {
      session: {
        accessToken: token,
        accessTokenExpiresAt: expiresAt.toISOString(),
        staff: this.result(row),
      },
      refreshToken,
    };
  }

  /**
   * Judges a sign-in attempt on a locked row: the step of a good code after a good password, or
   * why it was refused, counting the wrong try. An unknown email costs as much as a known one, and a locked
   * account answers as a wrong try does, without counting it.
   */
  private async attempt(
    tx: DirectoryTx,
    row: StaffRow | undefined,
    password: string,
    code: string,
  ): Promise<{ step: number } | { refused: string }> {
    const passwordOk = await verifyPassword(password, row?.passwordHash ?? DECOY_HASH);
    if (!row) return { refused: 'unknown_email' };
    if (row.status !== 'active' || !row.totpSecret) return { refused: `account_${row.status}` };
    if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) return { refused: 'locked' };
    const step = passwordOk
      ? matchTotp(this.cipher.open(row.totpSecret, this.where(row.id)), code, row.totpLastStep)
      : null;
    const failures = step === null ? row.failedSignIns + 1 : 0;
    await tx
      .update(platformUsers)
      .set({
        failedSignIns: failures >= LOCK.after ? 0 : failures,
        lockedUntil: failures >= LOCK.after ? new Date(Date.now() + LOCK.minutes * 60_000) : null,
      })
      .where(eq(platformUsers.id, row.id));
    if (step !== null) return { step };
    const reason = passwordOk ? 'wrong_code' : 'wrong_password';
    return { refused: failures >= LOCK.after ? `${reason}_now_locked` : reason };
  }

  /**
   * Refuses a new password built on the product's or the person's names, or known from a
   * breach, as a field error at `path`.
   */
  private async checkNew(password: string, row: StaffRow, path: string): Promise<void> {
    const words = passwordWords({
      product: [this.config.PRODUCT_NAME, this.config.PRODUCT_SLUG],
      email: row.email,
      name: row.name,
    });
    const issue =
      passwordWordsIssue(password, words) ??
      ((await this.breached.seen(password))
        ? 'This password is known from a data breach; choose another'
        : null);
    if (issue) throw new AppError('VALIDATION', 'Check the highlighted fields.', [{ path, issue }]);
  }

  private async endSessions(tx: DirectoryTx, staffId: string) {
    await tx
      .update(platformSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(platformSessions.platformUserId, staffId), isNull(platformSessions.revokedAt)));
  }

  private async endFamily(db: DirectoryTx | DirectoryDatabase['db'], familyId: string) {
    await db
      .update(platformSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(platformSessions.familyId, familyId), isNull(platformSessions.revokedAt)));
    // Its access tokens are refused too, once the ending commits (decision D101).
    this.database.whenCommitted(db as DirectoryTx, () => void this.ended.end([familyId]));
  }

  /** Where a seed is sealed: the column and the row, so it opens nowhere else. */
  private where(id: string): string {
    return `platform_users.totp_secret:${id}`;
  }

  private result(row: StaffRow): StaffResult {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role as PlatformRoleKey,
      status: row.status,
      permissions: [...PLATFORM_ROLE_PERMISSIONS[row.role]],
      lastSignInAt: row.lastSignInAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
