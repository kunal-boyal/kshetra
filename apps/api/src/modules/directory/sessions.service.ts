import { Injectable } from '@nestjs/common';
import {
  AppError,
  type DeviceInfo,
  newId,
  type OtpVerifyResult,
  type RefreshResult,
  type SecondFactor,
  type OwnSession,
  type Session,
  sessionExpiresAt,
  SESSION_LIMITS,
  type SignedIn,
  type TenantSummary,
} from '@thelamp/shared';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import {
  identities,
  memberships,
  refreshTokens,
  ssoConnections,
  supportGrants,
  totpSecrets,
} from '../../db/schema/directory';
import { EndedSessions } from '../../platform/ended-sessions';
import { CellAdmission, PeopleEmails } from '../../platform/planes';
import { RedisClient } from '../../platform/redis';
import { currentRequest } from '../../platform/request-context';
import { SecurityLog } from '../../platform/security-log';
import { DirectoryDatabase, type DirectoryDb, type DirectoryTx } from './directory.database';
import { activeMemberships, type MembershipRow } from './memberships';
import { digest, newSecret } from './secrets';
import { grantOpen, type SupportGrantRow, supportGrantRows } from './support-grants';
import { SigningKey } from './signing-key';

/** Refresh tokens rotate on every use (M1, rule 6); how long they live is `sessionExpiresAt()`. */
/** A sign-in waiting for its authenticator code has five minutes to give it (decision D91). */
export const TICKET_SECONDS = 5 * 60;

/** What a sign-in waiting for its authenticator code holds (decisions D91 and D101). */
interface Pending {
  membershipId: string;
  deviceId: string | null;
  /** It came through the organisation's SSO, whose provider asked for no second factor. */
  sso?: boolean;
}

/** Where a session's family began, which its limits count from (decision D101). */
interface Family {
  startedAt: Date;
  sso: boolean;
  /** When the session last gave a fresh authenticator code (decision D101). */
  steppedUpAt?: Date | null;
}

const fresh = (sso = false): Family => ({ startedAt: new Date(), sso });

const revoked = () => new AppError('SESSION_REVOKED', 'Your session has ended. Sign in again.');

type RefreshTokenRow = typeof refreshTokens.$inferSelect;

/** A refresh token still good, and whose it is: a member's, or vendor support's grant. */
type Claimed =
  | { token: RefreshTokenRow; membership: MembershipRow; grant?: never }
  | { token: RefreshTokenRow; grant: SupportGrantRow; membership?: never };

/**
 * Sessions: a refresh-token family per sign-in, with access tokens issued from it. Reusing a spent
 * refresh token ends the whole family, because only a copy could be presented twice. Before a
 * family starts, the tenant's cell admits the user and binds the phone (M1, rule 5); the family
 * keeps that device for good.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly keys: SigningKey,
    private readonly client: RedisClient,
    private readonly cell: CellAdmission,
    private readonly emails: PeopleEmails,
    private readonly security: SecurityLog,
    private readonly ended: EndedSessions,
  ) {}

  /**
   * After a verified code, the person's one organisation (decision D103): a number is active in
   * at most one, which the directory's index guarantees.
   */
  async signIn(phone: string, device?: DeviceInfo, ip?: string): Promise<OtpVerifyResult> {
    const [membership] = await activeMemberships(this.database.db, eq(identities.phoneE164, phone));
    if (!membership) throw new AppError('FORBIDDEN', 'This number has no active account.');
    await this.database.db
      .update(identities)
      .set({ lastLoginAt: new Date() })
      .where(eq(identities.id, membership.identityId));
    return this.start(membership, device, ip);
  }

  /** Spends a refresh token for a new pair in the same family. */
  async refresh(refreshToken: string): Promise<RefreshResult> {
    const result = await this.database.db.transaction(async (tx) => {
      const claimed = await this.claim(tx, refreshToken);
      if (!claimed) return null;
      await this.spend(tx, claimed.token);
      if (claimed.grant) {
        const session = await this.issueSupport(tx, claimed.grant, claimed.token.familyId);
        return { session, tenant: this.grantSummary(claimed.grant) };
      }
      const { membership, token } = claimed;
      const session = await this.issue(
        tx,
        membership,
        token.familyId,
        token.deviceId,
        token.secondFactor,
        { startedAt: token.familyStartedAt, sso: token.sso, steppedUpAt: token.steppedUpAt },
      );
      return { session, tenant: this.summary(membership) };
    });
    if (!result) throw revoked();
    return result;
  }

  /** Ends the session the token belongs to. Unknown tokens are ignored, so this reveals nothing. */
  async logout(refreshToken: string): Promise<void> {
    const [token] = await this.database.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, digest(refreshToken)));
    if (token) await this.endFamily(this.database.db, token.familyId);
  }

  /**
   * Locks a refresh token and checks it is still good: not spent, not expired, its membership
   * active in an open tenant, and its auth revision current (BR-39). Anything else ends the
   * family and returns null; the caller commits that before refusing.
   */
  private async claim(tx: DirectoryTx, refreshToken: string): Promise<Claimed | null> {
    const [token] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, digest(refreshToken)))
      .for('update');
    if (!token) return null;
    if (token.revokedAt) {
      // Only a copy is presented twice: the family ends, and that is a security event (D101).
      this.security.record({
        event: 'session_reused',
        plane: 'directory',
        subject: token.supportGrantId
          ? `support:${token.supportGrantId}`
          : `membership:${token.membershipId}`,
      });
      await this.endFamily(tx, token.familyId);
      return null;
    }
    if (token.supportGrantId) {
      // Vendor support's session lasts while its grant does, and its staff member's access.
      const [grant] = await supportGrantRows(tx, eq(supportGrants.id, token.supportGrantId), 1);
      if (
        !grant ||
        !grantOpen(grant) ||
        token.expiresAt.getTime() <= Date.now() ||
        token.authRevision !== grant.staffRevision
      ) {
        await this.endFamily(tx, token.familyId);
        return null;
      }
      return { token, grant };
    }
    const [membership] = await activeMemberships(tx, eq(memberships.id, token.membershipId!));
    const kind = token.deviceId ? 'phone' : token.sso ? 'sso' : 'web';
    if (
      !membership ||
      token.expiresAt.getTime() <= Date.now() ||
      // Past its absolute limit, however recently used (decision D101).
      token.familyStartedAt.getTime() + SESSION_LIMITS[kind].absoluteMs <= Date.now() ||
      token.authRevision !== membership.authRevision
    ) {
      await this.endFamily(tx, token.familyId);
      return null;
    }
    return { token, membership };
  }

  private async spend(tx: DirectoryTx, token: RefreshTokenRow): Promise<void> {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, token.id));
  }

  private async endFamily(db: DirectoryDb | DirectoryTx, familyId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
    // Its access tokens are refused too, once the ending commits (decision D101).
    this.database.whenCommitted(db as DirectoryTx, () => void this.ended.end([familyId]));
  }

  /** The member behind a tenant's user, whose own sessions these are. */
  private async membershipOf(tenantId: string, userId: string): Promise<string> {
    const [row] = await this.database.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
    if (!row) throw new AppError('NOT_FOUND', 'This was not found.');
    return row.id;
  }

  /**
   * Where someone is signed in to this tenant (ASVS V7.5.2, decision D101): each live session,
   * with when it began, when it was last refreshed, and from which browser or app and address.
   */
  async own(tenantId: string, userId: string, currentId?: string): Promise<OwnSession[]> {
    const membershipId = await this.membershipOf(tenantId, userId);
    // A live family has one unspent token, the one its last refresh made.
    const rows = await this.database.db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.membershipId, membershipId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(refreshTokens.createdAt));
    return rows.map((row) => ({
      id: row.familyId,
      kind: row.deviceId ? 'phone' : row.sso ? 'sso' : 'web',
      agent: row.userAgent,
      ip: row.ip,
      startedAt: row.familyStartedAt.toISOString(),
      lastUsedAt: row.createdAt.toISOString(),
      current: row.familyId === currentId,
    }));
  }

  /** Ends one of someone's own sessions; another's, or one already over, is not found. */
  async endOwn(tenantId: string, userId: string, sessionId: string): Promise<void> {
    const membershipId = await this.membershipOf(tenantId, userId);
    const [live] = await this.database.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.familyId, sessionId),
          eq(refreshTokens.membershipId, membershipId),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .limit(1);
    if (!live) throw new AppError('NOT_FOUND', 'This session has ended already.');
    await this.endFamily(this.database.db, sessionId);
  }

  /**
   * Marks a session as having just given a fresh authenticator code (step-up, decision D101) and
   * hands back an access token that says so; the session's later refreshes carry it on.
   */
  async stepUp(
    tenantId: string,
    userId: string,
    sessionId: string,
  ): Promise<{ accessToken: string; accessTokenExpiresAt: string }> {
    const membershipId = await this.membershipOf(tenantId, userId);
    const now = new Date();
    const [live] = await this.database.db
      .update(refreshTokens)
      .set({ steppedUpAt: now })
      .where(
        and(
          eq(refreshTokens.familyId, sessionId),
          eq(refreshTokens.membershipId, membershipId),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ deviceId: refreshTokens.deviceId });
    if (!live) throw revoked();
    const [membership] = await activeMemberships(
      this.database.db,
      eq(memberships.id, membershipId),
    );
    if (!membership) throw revoked();
    const access = await this.keys.sign({
      userId: membership.userId,
      tenantId: membership.tenantId,
      cell: membership.cellName,
      revision: membership.authRevision,
      sessionId,
      steppedUpAt: now,
      ...(live.deviceId ? { deviceId: live.deviceId } : {}),
    });
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString() };
  }

  /** Ends every one of someone's sessions in this tenant but the one asking. */
  async endOthers(tenantId: string, userId: string, currentId: string | undefined): Promise<void> {
    const membershipId = await this.membershipOf(tenantId, userId);
    const families = await this.database.db
      .selectDistinct({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.membershipId, membershipId),
          isNull(refreshTokens.revokedAt),
          ...(currentId ? [ne(refreshTokens.familyId, currentId)] : []),
        ),
      );
    for (const { familyId } of families) await this.endFamily(this.database.db, familyId);
  }

  private async start(
    row: MembershipRow,
    device: DeviceInfo | undefined,
    ip: string | undefined,
  ): Promise<SignedIn | SecondFactor> {
    if (!device) await this.refuseWhereSsoRequired(row);
    const { deviceId, secondFactor } = await this.cell.admit({
      tenantId: row.tenantId,
      userId: row.userId,
      ...(device ? { device } : {}),
      ...(ip ? { ip } : {}),
    });
    const enrolled = await this.enrolled(row.identityId);
    // On the web, an admin always gives an authenticator code, and so does anyone who set one up
    // (decisions D91 and D101); phones and demo tenants never do.
    if (!device && (secondFactor || enrolled) && !row.tenantDemo) {
      return this.awaitSecondFactor(
        row,
        { membershipId: row.membershipId, deviceId: null },
        enrolled,
      );
    }
    const session = await this.issue(this.database.db, row, newId(), deviceId);
    this.signInLogged(row, 'sms_code', device ? ['sms_code', 'bound_device'] : ['sms_code']);
    return this.signedIn(row, session);
  }

  /** Whether a person has set an authenticator up, as an admin must and anyone may. */
  private async enrolled(identityId: string): Promise<boolean> {
    const [totp] = await this.database.db
      .select({ enabledAt: totpSecrets.enabledAt })
      .from(totpSecrets)
      .where(eq(totpSecrets.identityId, identityId));
    return Boolean(totp?.enabledAt);
  }

  /** The session waits for the authenticator code, on a ticket of its own (D91). */
  private async awaitSecondFactor(
    row: MembershipRow,
    pending: Pending,
    enrolled: boolean,
  ): Promise<SecondFactor> {
    const ticket = newSecret();
    await this.client.redis.set(
      `second:${digest(ticket)}`,
      JSON.stringify(pending),
      'EX',
      TICKET_SECONDS,
    );
    return {
      status: 'second_factor',
      ticket,
      enrolled,
      tenant: { id: row.tenantId, name: row.tenantName },
    };
  }

  /**
   * A tenant that requires single sign-on refuses web OTP to its people in the connection's
   * domains (decision D91); phones, and people outside those domains, carry on.
   */
  private async refuseWhereSsoRequired(row: MembershipRow): Promise<void> {
    const [connection] = await this.database.db
      .select({ enforced: ssoConnections.enforced, domains: ssoConnections.domains })
      .from(ssoConnections)
      .where(and(eq(ssoConnections.tenantId, row.tenantId), eq(ssoConnections.enabled, true)));
    if (!connection?.enforced) return;
    const email = await this.emails.emailOf(row.tenantId, row.userId);
    const domain = email?.split('@')[1]?.toLowerCase();
    if (domain && connection.domains.includes(domain)) {
      throw new AppError(
        'SSO_REQUIRED',
        'Your organisation signs you in with its own sign-in. Choose Sign in with SSO.',
      );
    }
  }

  /**
   * Starts a web session for someone their organisation's identity provider vouched for
   * (decisions D91 and D101). Where the provider says it asked for a second factor, ours isn't;
   * where it doesn't, an admin, or anyone who set an authenticator up, gives our code too.
   */
  async ssoSignIn(
    row: MembershipRow,
    ip: string | undefined,
    providerMfa: boolean,
  ): Promise<SignedIn | SecondFactor> {
    const { secondFactor } = await this.cell.admit({
      tenantId: row.tenantId,
      userId: row.userId,
      ...(ip ? { ip } : {}),
    });
    const enrolled = await this.enrolled(row.identityId);
    if (!providerMfa && (secondFactor || enrolled) && !row.tenantDemo) {
      return this.awaitSecondFactor(
        row,
        { membershipId: row.membershipId, deviceId: null, sso: true },
        enrolled,
      );
    }
    const session = await this.issue(
      this.database.db,
      row,
      newId(),
      null,
      providerMfa,
      fresh(true),
    );
    this.signInLogged(row, 'sso', providerMfa ? ['sso', 'provider_mfa'] : ['sso']);
    return this.signedIn(row, session);
  }

  /** The sign-in a second-factor ticket holds, while it lasts; the ticket stays unspent. */
  async pending(ticket: string): Promise<{ membership: MembershipRow; deviceId: string | null }> {
    const held = await this.client.redis.get(`second:${digest(ticket)}`);
    if (!held) throw new AppError('OTP_EXPIRED', 'This sign-in has expired. Request a new code.');
    const pending = JSON.parse(held) as Pending;
    const [membership] = await activeMemberships(
      this.database.db,
      eq(memberships.id, pending.membershipId),
    );
    if (!membership) throw revoked();
    return { membership, deviceId: pending.deviceId };
  }

  /**
   * Spends a second-factor ticket once its code checked out, and starts the session; `used`
   * says which kind of code it was.
   */
  async finish(
    ticket: string,
    used: 'authenticator' | 'recovery_code' = 'authenticator',
  ): Promise<SignedIn> {
    const held = await this.client.redis.getdel(`second:${digest(ticket)}`);
    if (!held) throw new AppError('OTP_EXPIRED', 'This sign-in has expired. Request a new code.');
    const pending = JSON.parse(held) as Pending;
    const [membership] = await activeMemberships(
      this.database.db,
      eq(memberships.id, pending.membershipId),
    );
    if (!membership) throw revoked();
    const session = await this.issue(
      this.database.db,
      membership,
      newId(),
      pending.deviceId,
      true,
      fresh(pending.sso ?? false),
    );
    const first = pending.sso ? 'sso' : 'sms_code';
    this.signInLogged(membership, first, [first, used]);
    return this.signedIn(membership, session);
  }

  /** Ends every session of a person, in every tenant, as resetting their authenticator does. */
  async endAll(identityId: string): Promise<void> {
    const families = await this.database.db
      .selectDistinct({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .innerJoin(memberships, eq(memberships.id, refreshTokens.membershipId))
      .where(and(eq(memberships.identityId, identityId), isNull(refreshTokens.revokedAt)));
    for (const { familyId } of families) await this.endFamily(this.database.db, familyId);
  }

  /**
   * Starts vendor support's web session under an open grant (decision D93). It ends when the grant
   * does, and every request checks the grant again.
   */
  async supportSignIn(grant: SupportGrantRow): Promise<SignedIn> {
    if (!grantOpen(grant)) throw revoked();
    const session = await this.issueSupport(this.database.db, grant, newId());
    this.security.record({
      event: 'signed_in',
      plane: 'directory',
      tenantId: grant.tenantId,
      actor: `support:${grant.id}`,
      method: 'support_grant',
      factors: ['staff_session', 'support_grant'],
    });
    return { status: 'signed_in', tenant: this.grantSummary(grant), session };
  }

  private grantSummary(grant: SupportGrantRow): TenantSummary {
    return { id: grant.tenantId, name: grant.tenantName, cellUrl: grant.cellUrl };
  }

  private async issueSupport(
    db: DirectoryDb | DirectoryTx,
    grant: SupportGrantRow,
    familyId: string,
  ): Promise<Session> {
    const refreshToken = newSecret();
    const refreshTokenExpiresAt = grant.endsAt!;
    await db.insert(refreshTokens).values({
      id: newId(),
      supportGrantId: grant.id,
      tokenHash: digest(refreshToken),
      familyId,
      authRevision: grant.staffRevision,
      expiresAt: refreshTokenExpiresAt,
    });
    const access = await this.keys.sign({
      userId: grant.staffId,
      tenantId: grant.tenantId,
      cell: grant.cellName,
      revision: grant.staffRevision,
      supportGrantId: grant.id,
      sessionId: familyId,
    });
    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    };
  }

  /** A finished sign-in, with how it was made (ASVS V16.3.1, decision D101). */
  private signInLogged(row: MembershipRow, method: string, factors: string[]): void {
    this.security.record({
      event: 'signed_in',
      plane: 'directory',
      tenantId: row.tenantId,
      actor: `user:${row.userId}`,
      method,
      factors,
    });
  }

  private signedIn(row: MembershipRow, session: Session): SignedIn {
    return { status: 'signed_in', tenant: this.summary(row), session };
  }

  private summary(row: MembershipRow): TenantSummary {
    return { id: row.tenantId, name: row.tenantName, cellUrl: row.cellUrl };
  }

  /** Where the request issuing a token came from, for the person's list of sessions. */
  private place(): { userAgent: string | null; ip: string | null } {
    const request = currentRequest();
    const agent = request?.headers['user-agent'];
    return {
      userAgent: typeof agent === 'string' ? agent.slice(0, 300) : null,
      ip: request?.clientIp || null,
    };
  }

  private async issue(
    db: DirectoryDb | DirectoryTx,
    row: MembershipRow,
    familyId: string,
    deviceId: string | null | undefined,
    secondFactor = false,
    family: Family = fresh(),
  ): Promise<Session> {
    const refreshToken = newSecret();
    const kind = deviceId ? 'phone' : family.sso ? 'sso' : 'web';
    const refreshTokenExpiresAt = new Date(
      sessionExpiresAt(kind, family.startedAt.getTime(), Date.now()),
    );
    await db.insert(refreshTokens).values({
      id: newId(),
      membershipId: row.membershipId,
      deviceId: deviceId ?? null,
      tokenHash: digest(refreshToken),
      familyId,
      authRevision: row.authRevision,
      expiresAt: refreshTokenExpiresAt,
      secondFactor,
      familyStartedAt: family.startedAt,
      sso: family.sso,
      steppedUpAt: family.steppedUpAt ?? null,
      ...this.place(),
    });
    const access = await this.keys.sign({
      userId: row.userId,
      tenantId: row.tenantId,
      cell: row.cellName,
      revision: row.authRevision,
      sessionId: familyId,
      steppedUpAt: family.steppedUpAt ?? null,
      ...(deviceId ? { deviceId } : {}),
    });
    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    };
  }
}
