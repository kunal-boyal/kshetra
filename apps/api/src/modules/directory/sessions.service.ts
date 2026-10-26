import { Injectable } from '@nestjs/common';
import {
  AppError,
  type DeviceInfo,
  newId,
  type OtpVerifyResult,
  type RefreshResult,
  type SecondFactor,
  type SelectTenantResult,
  type Session,
  sessionExpiresAt,
  SESSION_LIMITS,
  type SignedIn,
  type TenantSummary,
} from '@thelamp/shared';
import { and, eq, isNull } from 'drizzle-orm';
import {
  identities,
  memberships,
  refreshTokens,
  ssoConnections,
  supportGrants,
  totpSecrets,
} from '../../db/schema/directory';
import { CellAdmission, PeopleEmails } from '../../platform/planes';
import { RedisClient } from '../../platform/redis';
import { DirectoryDatabase, type DirectoryDb, type DirectoryTx } from './directory.database';
import { activeMemberships, type MembershipRow } from './memberships';
import { digest, newSecret } from './secrets';
import { grantOpen, type SupportGrantRow, supportGrantRows } from './support-grants';
import { SigningKey } from './signing-key';

/** Refresh tokens rotate on every use (M1, rule 6); how long they live is `sessionExpiresAt()`. */
/** A person in several tenants has five minutes to choose one after the code (M1, rule 4). */
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
  ) {}

  /** After a verified code: one tenant signs straight in; several get a ticket to choose with. */
  async signIn(phone: string, device?: DeviceInfo, ip?: string): Promise<OtpVerifyResult> {
    const rows = await activeMemberships(this.database.db, eq(identities.phoneE164, phone));
    const [first] = rows;
    if (!first) throw new AppError('FORBIDDEN', 'This number has no active account.');
    await this.database.db
      .update(identities)
      .set({ lastLoginAt: new Date() })
      .where(eq(identities.id, first.identityId));
    if (rows.length === 1) return this.start(first, device, ip);

    const ticket = newSecret();
    await this.client.redis.set(`ticket:${digest(ticket)}`, first.identityId, 'EX', TICKET_SECONDS);
    return {
      status: 'choose_tenant',
      ticket,
      tenants: rows.map((row) => ({ id: row.tenantId, name: row.tenantName })),
    };
  }

  /** Spends a ticket on one of the identity's tenants. A ticket works once. */
  async selectTenant(
    ticket: string,
    tenantId: string,
    device?: DeviceInfo,
    ip?: string,
  ): Promise<SelectTenantResult> {
    const identityId = await this.client.redis.getdel(`ticket:${digest(ticket)}`);
    if (!identityId) {
      throw new AppError('OTP_EXPIRED', 'This sign-in has expired. Request a new code.');
    }
    const [row] = await activeMemberships(
      this.database.db,
      and(eq(memberships.identityId, identityId), eq(memberships.tenantId, tenantId)),
    );
    if (!row) throw new AppError('FORBIDDEN', 'You do not have access to this organisation.');
    return this.start(row, device, ip);
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
        { startedAt: token.familyStartedAt, sso: token.sso },
      );
      return { session, tenant: this.summary(membership) };
    });
    if (!result) throw revoked();
    return result;
  }

  /** Moves the session to another tenant of the same person, without a second code (M1, rule 4). */
  async switchTenant(
    refreshToken: string,
    tenantId: string,
    device?: DeviceInfo,
    ip?: string,
  ): Promise<SignedIn> {
    const result = await this.database.db.transaction(async (tx) => {
      const claimed = await this.claim(tx, refreshToken);
      if (!claimed) return 'revoked' as const;
      // Vendor support stays in the tenant its grant names.
      if (!claimed.membership) return 'forbidden' as const;
      const [target] = await activeMemberships(
        tx,
        and(
          eq(memberships.identityId, claimed.membership.identityId),
          eq(memberships.tenantId, tenantId),
        ),
      );
      if (!target) return 'forbidden' as const;
      // Refused admission rolls this back, and the old session carries on.
      const { deviceId, secondFactor } = await this.cell.admit({
        tenantId: target.tenantId,
        userId: target.userId,
        ...(device ? { device } : {}),
        ...(ip ? { ip } : {}),
      });
      // A session that never gave an authenticator code can't carry on as an admin (D91).
      if (secondFactor && !target.tenantDemo && !claimed.token.secondFactor) {
        return 'second_factor' as const;
      }
      // One app holds one tenant at a time, so the old session ends.
      await this.endFamily(tx, claimed.token.familyId);
      // A new family in the new tenant, still counted from the first sign-in (decision D101).
      const session = await this.issue(tx, target, newId(), deviceId, claimed.token.secondFactor, {
        startedAt: claimed.token.familyStartedAt,
        sso: claimed.token.sso,
      });
      return { session, target };
    });
    if (result === 'revoked') throw revoked();
    if (result === 'second_factor') {
      throw new AppError(
        'SECOND_FACTOR_REQUIRED',
        'Sign in again with your authenticator to open this organisation.',
      );
    }
    if (result === 'forbidden') {
      throw new AppError('FORBIDDEN', 'You do not have access to this organisation.');
    }
    return this.signedIn(result.target, result.session);
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
    return this.signedIn(row, await this.issue(this.database.db, row, newId(), deviceId));
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
    return this.signedIn(
      row,
      await this.issue(this.database.db, row, newId(), null, providerMfa, fresh(true)),
    );
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

  /** Spends a second-factor ticket once its code checked out, and starts the session. */
  async finish(ticket: string): Promise<SignedIn> {
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
    });
    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    };
  }

  private signedIn(row: MembershipRow, session: Session): SignedIn {
    return { status: 'signed_in', tenant: this.summary(row), session };
  }

  private summary(row: MembershipRow): TenantSummary {
    return { id: row.tenantId, name: row.tenantName, cellUrl: row.cellUrl };
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
    });
    const access = await this.keys.sign({
      userId: row.userId,
      tenantId: row.tenantId,
      cell: row.cellName,
      revision: row.authRevision,
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
