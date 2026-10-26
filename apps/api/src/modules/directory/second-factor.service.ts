import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppError, maskPhone, type TotpSetupResult, type TotpVerifyResult } from '@thelamp/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Config } from '../../config';
import { identities, memberships, totpSecrets } from '../../db/schema/directory';
import { ColumnCipher } from '../../platform/column-cipher';
import { hashPassword, RECOVERY_CODE_COST, verifyPassword } from '../../platform/passwords';
import { SecondFactors } from '../../platform/planes';
import { RedisClient } from '../../platform/redis';
import { SecurityLog } from '../../platform/security-log';
import { CONFIG } from '../../platform/tokens';
import { matchTotp, newTotpSecret, otpauthUri, toBase32 } from '../../platform/totp';
import { DirectoryDatabase } from './directory.database';
import { digest } from './secrets';
import { SessionsService, TICKET_SECONDS } from './sessions.service';

/** Wrong codes a second-factor ticket takes before it ends and the sign-in starts again. */
export const SECOND_FACTOR_TRIES = 5;
/** Recovery codes given when an authenticator is set up; each works once. */
export const RECOVERY_CODES = 10;

const wrongCode = () =>
  new AppError('OTP_INVALID', 'Check the code in your authenticator and try again.');

/** A recovery code as people read it, such as K7Q2M-XW4PA, and as it is compared. */
function recoveryCode(): string {
  const text = toBase32(randomBytes(7)).slice(0, 10);
  return `${text.slice(0, 5)}-${text.slice(5)}`;
}
const recoveryText = (code: string) => code.replace('-', '').toUpperCase();

/** Ten new recovery codes and their salted scrypt hashes, which alone are kept (decision D101). */
async function newRecoveryCodes(): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = Array.from({ length: RECOVERY_CODES }, recoveryCode);
  const hashes = await Promise.all(
    codes.map((code) => hashPassword(recoveryText(code), RECOVERY_CODE_COST)),
  );
  return { codes, hashes };
}

/**
 * The kept hash a recovery code matches, or undefined. Codes handed out before decision D101
 * were kept as plain SHA-256 digests; those still match until used or replaced.
 */
async function matchingRecoveryHash(code: string, hashes: string[]): Promise<string | undefined> {
  const text = recoveryText(code);
  for (const hash of hashes) {
    if (hash.startsWith('scrypt$') ? await verifyPassword(text, hash) : hash === digest(text)) {
      return hash;
    }
  }
  return undefined;
}

/**
 * The second factor of web sign-in for people who can change access (spec M1, decision D91): a
 * TOTP authenticator per person, set up at their first such sign-in, with ten single-use recovery
 * codes. Its secret is sealed in its column; no code works twice. Resetting it removes it and
 * ends the person's sessions, so they set it up again at their next sign-in.
 */
@Injectable()
export class SecondFactorService extends SecondFactors {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly sessions: SessionsService,
    private readonly cipher: ColumnCipher,
    private readonly client: RedisClient,
    private readonly security: SecurityLog,
    @Inject(CONFIG) private readonly config: Config,
  ) {
    super();
  }

  /** A new secret for someone signing in without an authenticator; a later one replaces it. */
  async setup(ticket: string): Promise<TotpSetupResult> {
    const { membership } = await this.sessions.pending(ticket);
    return this.newSecretFor(membership.identityId);
  }

  /** A new, unconfirmed secret for a person without an authenticator; a later one replaces it. */
  private async newSecretFor(identityId: string): Promise<TotpSetupResult> {
    const [existing] = await this.database.db
      .select({ enabledAt: totpSecrets.enabledAt })
      .from(totpSecrets)
      .where(eq(totpSecrets.identityId, identityId));
    if (existing?.enabledAt) {
      throw new AppError('CONFLICT', 'You have an authenticator already. Enter its code.');
    }
    const secret = newTotpSecret();
    const values = {
      secretSealed: this.cipher.seal(secret, where(identityId)),
      enabledAt: null,
      lastStep: null,
      recoveryHashes: [],
    };
    await this.database.db
      .insert(totpSecrets)
      .values({ identityId, ...values })
      .onConflictDoUpdate({ target: totpSecrets.identityId, set: values });
    const [identity] = await this.database.db
      .select({ phone: identities.phoneE164 })
      .from(identities)
      .where(eq(identities.id, identityId));
    return {
      secret,
      uri: otpauthUri(this.config.PRODUCT_NAME, maskPhone(identity!.phone), secret),
    };
  }

  /**
   * Checks the authenticator's code, or a recovery code, and signs in. The first good code sets
   * the authenticator up and hands out the recovery codes, once.
   */
  async verify(
    ticket: string,
    answer: { code?: string | undefined; recoveryCode?: string | undefined },
  ): Promise<TotpVerifyResult> {
    const { membership } = await this.sessions.pending(ticket);
    const used = answer.code ? 'authenticator' : 'recovery_code';
    const failed = (reason: string) =>
      this.security.record({
        event: 'sign_in_failed',
        plane: 'directory',
        tenantId: membership.tenantId,
        actor: `user:${membership.userId}`,
        method: used,
        reason,
      });
    const tries = `second-tries:${digest(ticket)}`;
    const count = await this.client.redis.incr(tries);
    if (count === 1) await this.client.redis.expire(tries, TICKET_SECONDS);
    if (count > SECOND_FACTOR_TRIES) {
      failed('too_many_tries');
      await this.client.redis.del(`second:${digest(ticket)}`);
      throw new AppError('OTP_EXPIRED', 'Too many tries. Request a new code to sign in again.');
    }
    const identityId = membership.identityId;
    const recoveryCodes = await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.identityId, identityId))
        .for('update');
      if (!row) throw new AppError('CONFLICT', 'Set up your authenticator first.');
      if (answer.code) {
        const step = matchTotp(
          this.cipher.open(row.secretSealed, where(identityId)),
          answer.code,
          row.lastStep,
        );
        if (step === null) {
          failed('wrong_code');
          throw wrongCode();
        }
        const fresh = row.enabledAt ? null : await newRecoveryCodes();
        await tx
          .update(totpSecrets)
          .set({
            lastStep: step,
            ...(fresh ? { enabledAt: new Date(), recoveryHashes: fresh.hashes } : {}),
          })
          .where(eq(totpSecrets.identityId, identityId));
        return fresh?.codes ?? null;
      }
      const hash = row.enabledAt
        ? await matchingRecoveryHash(answer.recoveryCode ?? '', row.recoveryHashes)
        : undefined;
      if (!hash) {
        failed('wrong_recovery_code');
        throw new AppError(
          'OTP_INVALID',
          'This recovery code is not one of yours, or it was used already.',
        );
      }
      await tx
        .update(totpSecrets)
        .set({ recoveryHashes: row.recoveryHashes.filter((each) => each !== hash) })
        .where(eq(totpSecrets.identityId, identityId));
      return null;
    });
    await this.client.redis.del(tries);
    const signedIn = await this.sessions.finish(ticket, used);
    return recoveryCodes ? { ...signedIn, recoveryCodes } : signedIn;
  }

  /** The identity behind a tenant's member, who is managing their own authenticator. */
  private async identityOf(tenantId: string, userId: string): Promise<string> {
    const [membership] = await this.database.db
      .select({ identityId: memberships.identityId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
    if (!membership) throw new AppError('NOT_FOUND', 'This was not found.');
    return membership.identityId;
  }

  /** Counts a wrong code against a person's own authenticator settings: five in ten minutes. */
  private async tried(identityId: string): Promise<void> {
    const key = `own-totp-tries:${identityId}`;
    const count = await this.client.redis.incr(key);
    if (count === 1) await this.client.redis.expire(key, TICKET_SECONDS * 2);
    if (count > SECOND_FACTOR_TRIES) {
      throw new AppError('RATE_LIMITED', 'Too many tries. Wait a few minutes and try again.');
    }
  }

  /** Whether someone has an authenticator set up (decision D101). */
  async ownStatus(tenantId: string, userId: string): Promise<boolean> {
    const identityId = await this.identityOf(tenantId, userId);
    const [row] = await this.database.db
      .select({ enabledAt: totpSecrets.enabledAt })
      .from(totpSecrets)
      .where(eq(totpSecrets.identityId, identityId));
    return Boolean(row?.enabledAt);
  }

  /** Starts setting up someone's own authenticator, from their account (decision D101). */
  async ownSetup(tenantId: string, userId: string): Promise<TotpSetupResult> {
    return this.newSecretFor(await this.identityOf(tenantId, userId));
  }

  /** Confirms a new authenticator with its first code and hands out the recovery codes, once. */
  async ownConfirm(tenantId: string, userId: string, code: string): Promise<string[]> {
    const identityId = await this.identityOf(tenantId, userId);
    await this.tried(identityId);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.identityId, identityId))
        .for('update');
      if (!row) throw new AppError('CONFLICT', 'Start setting up your authenticator first.');
      if (row.enabledAt) throw new AppError('CONFLICT', 'Your authenticator is set up already.');
      const step = matchTotp(
        this.cipher.open(row.secretSealed, where(identityId)),
        code,
        row.lastStep,
      );
      if (step === null) throw wrongCode();
      const fresh = await newRecoveryCodes();
      await tx
        .update(totpSecrets)
        .set({ lastStep: step, enabledAt: new Date(), recoveryHashes: fresh.hashes })
        .where(eq(totpSecrets.identityId, identityId));
      return fresh.codes;
    });
  }

  /**
   * Removes someone's own authenticator, given a current code from it, where their role doesn't
   * need one; the web then signs them in by SMS code alone again (decision D101).
   */
  async ownRemove(tenantId: string, userId: string, code: string): Promise<void> {
    const identityId = await this.identityOf(tenantId, userId);
    await this.tried(identityId);
    await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.identityId, identityId))
        .for('update');
      if (!row?.enabledAt) throw new AppError('CONFLICT', 'You have no authenticator set up.');
      if (
        matchTotp(this.cipher.open(row.secretSealed, where(identityId)), code, row.lastStep) ===
        null
      ) {
        throw wrongCode();
      }
      await tx.delete(totpSecrets).where(eq(totpSecrets.identityId, identityId));
    });
  }

  /**
   * Checks a fresh code from someone's own authenticator, for a step-up (decision D101): spent
   * once, and counted against their five tries in ten minutes. Without an authenticator there is
   * nothing to step up with, and the answer says where to set one up.
   */
  async ownCheck(tenantId: string, userId: string, code: string): Promise<void> {
    const identityId = await this.identityOf(tenantId, userId);
    await this.tried(identityId);
    await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.identityId, identityId))
        .for('update');
      if (!row?.enabledAt) {
        throw new AppError(
          'CONFLICT',
          'Set up an authenticator at Sign-in security first; this change needs a code from it.',
        );
      }
      const step = matchTotp(
        this.cipher.open(row.secretSealed, where(identityId)),
        code,
        row.lastStep,
      );
      if (step === null) throw wrongCode();
      await tx
        .update(totpSecrets)
        .set({ lastStep: step })
        .where(eq(totpSecrets.identityId, identityId));
    });
  }

  /** Which of a tenant's people have an authenticator set up, by user. */
  async enrolled(tenantId: string, userIds: readonly string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.database.db
      .select({ userId: memberships.userId, enabledAt: totpSecrets.enabledAt })
      .from(memberships)
      .innerJoin(totpSecrets, eq(totpSecrets.identityId, memberships.identityId))
      .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, [...userIds])));
    return new Set(rows.filter((row) => row.enabledAt !== null).map((row) => row.userId));
  }

  /** Removes a person's authenticator and ends their sessions everywhere. */
  async reset(tenantId: string, userId: string): Promise<boolean> {
    const [membership] = await this.database.db
      .select({ identityId: memberships.identityId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
    if (!membership) return false;
    const removed = await this.database.db
      .delete(totpSecrets)
      .where(eq(totpSecrets.identityId, membership.identityId))
      .returning({ identityId: totpSecrets.identityId });
    await this.sessions.endAll(membership.identityId);
    return removed.length > 0;
  }

  /** The identity behind a tenant's member with this number, for vendor support's resets. */
  async userByPhone(tenantId: string, phone: string): Promise<string | undefined> {
    const [row] = await this.database.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(identities, eq(identities.id, memberships.identityId))
      .where(and(eq(memberships.tenantId, tenantId), eq(identities.phoneE164, phone)));
    return row?.userId;
  }
}

/** The context a sealed secret belongs to: its column and its row. */
function where(identityId: string): string {
  return `totp_secrets.secret_sealed:${identityId}`;
}
