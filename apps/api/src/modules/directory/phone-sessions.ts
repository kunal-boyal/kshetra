import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { memberships, refreshTokens } from '../../db/schema/directory';
import { PhoneSessions } from '../../platform/planes';
import { DirectoryDatabase } from './directory.database';

/**
 * Which phones are signed in now (M16): a refresh token for the device not spent and not expired
 * (its expiry already keeps the absolute limit), of an active membership in the tenant, issued at
 * the membership's current auth revision, as a refresh would accept it.
 */
@Injectable()
export class DirectoryPhoneSessions extends PhoneSessions {
  constructor(private readonly database: DirectoryDatabase) {
    super();
  }

  async signedIn(tenantId: string, deviceIds: readonly string[]): Promise<Set<string>> {
    if (deviceIds.length === 0) return new Set();
    const rows = await this.database.db
      .selectDistinct({ deviceId: refreshTokens.deviceId })
      .from(refreshTokens)
      .innerJoin(memberships, eq(memberships.id, refreshTokens.membershipId))
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.status, 'active'),
          eq(refreshTokens.authRevision, memberships.authRevision),
          inArray(refreshTokens.deviceId, [...deviceIds]),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      );
    return new Set(rows.flatMap((row) => (row.deviceId ? [row.deviceId] : [])));
  }
}
