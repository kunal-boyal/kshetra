import { Injectable } from '@nestjs/common';
import {
  AppError,
  type DeviceInfo,
  newId,
  type OtpVerifyResult,
  type RefreshResult,
  type Session,
  type SignedIn,
} from '@kshetra/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { identities, memberships, refreshTokens } from '../../db/schema/directory';
import { CellAdmission } from '../../platform/planes';
import { RedisClient } from '../../platform/redis';
import { DirectoryDatabase, type DirectoryDb, type DirectoryTx } from './directory.database';
import { activeMemberships, type MembershipRow } from './memberships';
import { digest, newSecret } from './secrets';
import { SigningKey } from './signing-key';

/** Refresh tokens live 30 days and rotate on every use (M1, rule 6). */
export const REFRESH_TOKEN_DAYS = 30;
/** A person in several tenants has five minutes to choose one after the code (M1, rule 4). */
export const TICKET_SECONDS = 5 * 60;

const revoked = () => new AppError('SESSION_REVOKED', 'Your session has ended. Sign in again.');

type RefreshTokenRow = typeof refreshTokens.$inferSelect;

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
  ) {}

  /** After a verified code: one tenant signs straight in; several get a ticket to choose with. */
  async signIn(phone: string, device?: DeviceInfo): Promise<OtpVerifyResult> {
    const rows = await activeMemberships(this.database.db, eq(identities.phoneE164, phone));
    const [first] = rows;
    if (!first) throw new AppError('FORBIDDEN', 'This number has no active account.');
    await this.database.db
      .update(identities)
      .set({ lastLoginAt: new Date() })
      .where(eq(identities.id, first.identityId));
    if (rows.length === 1) return this.start(first, device);

    const ticket = newSecret();
    await this.client.redis.set(`ticket:${digest(ticket)}`, first.identityId, 'EX', TICKET_SECONDS);
    return {
      status: 'choose_tenant',
      ticket,
      tenants: rows.map((row) => ({ id: row.tenantId, name: row.tenantName })),
    };
  }

  /** Spends a ticket on one of the identity's tenants. A ticket works once. */
  async selectTenant(ticket: string, tenantId: string, device?: DeviceInfo): Promise<SignedIn> {
    const identityId = await this.client.redis.getdel(`ticket:${digest(ticket)}`);
    if (!identityId) {
      throw new AppError('OTP_EXPIRED', 'This sign-in has expired. Request a new code.');
    }
    const [row] = await activeMemberships(
      this.database.db,
      and(eq(memberships.identityId, identityId), eq(memberships.tenantId, tenantId)),
    );
    if (!row) throw new AppError('FORBIDDEN', 'You do not have access to this organisation.');
    return this.start(row, device);
  }

  /** Spends a refresh token for a new pair in the same family. */
  async refresh(refreshToken: string): Promise<RefreshResult> {
    const session = await this.database.db.transaction(async (tx) => {
      const claimed = await this.claim(tx, refreshToken);
      if (!claimed) return null;
      await this.spend(tx, claimed.token);
      return this.issue(tx, claimed.membership, claimed.token.familyId, claimed.token.deviceId);
    });
    if (!session) throw revoked();
    return { session };
  }

  /** Moves the session to another tenant of the same person, without a second code (M1, rule 4). */
  async switchTenant(
    refreshToken: string,
    tenantId: string,
    device?: DeviceInfo,
  ): Promise<SignedIn> {
    const result = await this.database.db.transaction(async (tx) => {
      const claimed = await this.claim(tx, refreshToken);
      if (!claimed) return 'revoked' as const;
      const [target] = await activeMemberships(
        tx,
        and(
          eq(memberships.identityId, claimed.membership.identityId),
          eq(memberships.tenantId, tenantId),
        ),
      );
      if (!target) return 'forbidden' as const;
      // Refused admission rolls this back, and the old session carries on.
      const { deviceId } = await this.cell.admit({
        tenantId: target.tenantId,
        userId: target.userId,
        ...(device ? { device } : {}),
      });
      // One app holds one tenant at a time, so the old session ends.
      await this.endFamily(tx, claimed.token.familyId);
      const session = await this.issue(tx, target, newId(), deviceId);
      return { session, target };
    });
    if (result === 'revoked') throw revoked();
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
  private async claim(
    tx: DirectoryTx,
    refreshToken: string,
  ): Promise<{ token: RefreshTokenRow; membership: MembershipRow } | null> {
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
    const [membership] = await activeMemberships(tx, eq(memberships.id, token.membershipId));
    if (
      !membership ||
      token.expiresAt.getTime() <= Date.now() ||
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

  private async start(row: MembershipRow, device: DeviceInfo | undefined): Promise<SignedIn> {
    const { deviceId } = await this.cell.admit({
      tenantId: row.tenantId,
      userId: row.userId,
      ...(device ? { device } : {}),
    });
    return this.signedIn(row, await this.issue(this.database.db, row, newId(), deviceId));
  }

  private signedIn(row: MembershipRow, session: Session): SignedIn {
    return {
      status: 'signed_in',
      tenant: { id: row.tenantId, name: row.tenantName, cellUrl: row.cellUrl },
      session,
    };
  }

  private async issue(
    db: DirectoryDb | DirectoryTx,
    row: MembershipRow,
    familyId: string,
    deviceId: string | null | undefined,
  ): Promise<Session> {
    const refreshToken = newSecret();
    const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86_400_000);
    await db.insert(refreshTokens).values({
      id: newId(),
      membershipId: row.membershipId,
      deviceId: deviceId ?? null,
      tokenHash: digest(refreshToken),
      familyId,
      authRevision: row.authRevision,
      expiresAt: refreshTokenExpiresAt,
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
