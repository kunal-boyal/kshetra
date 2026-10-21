import { Injectable } from '@nestjs/common';
import { todayIn } from '@kshetra/shared';
import { and, eq, or, type SQL, sql } from 'drizzle-orm';
import { reportingClosure, users } from '../../db/schema/iam';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TerritoriesService } from '../territories/territories.service';

/**
 * Whose records a caller's data scope reaches (spec 4.2). Every scope reaches the caller; `team`
 * adds everyone below them in the reporting tree, `territory` everyone attached at or below their
 * territories, and `tenant` everyone. Later modules filter their records with the same conditions.
 */
@Injectable()
export class Scopes {
  constructor(
    private readonly territories: TerritoriesService,
    private readonly config: TenantConfigService,
  ) {}

  /** A condition on `users` that holds for the users the caller reaches. */
  async users(tx: TenantTx, access: Access): Promise<SQL> {
    const self = eq(users.id, access.userId);
    // The closure pairs each user with themselves at depth 0, so a team includes its manager.
    const team = sql`exists (
      select 1 from ${reportingClosure} rc
       where rc.tenant_id = ${users.tenantId}
         and rc.ancestor_id = ${access.userId}
         and rc.descendant_id = ${users.id})`;
    // Attachments apply by the tenant's calendar, so "today" is in its timezone.
    const territory = async () => {
      const { timezone } = await this.config.settings(tx, access.tenantId);
      const reached = this.territories.usersReachedBy(
        access.tenantId,
        access.userId,
        todayIn(timezone),
      );
      return sql`${users.id} in (${reached})`;
    };
    switch (access.scope) {
      case 'self':
        return self;
      case 'team':
        return team;
      case 'territory':
        return or(self, await territory())!;
      case 'team_or_territory':
        return or(team, await territory())!;
      case 'tenant':
        return sql`true`;
    }
  }

  /** A subquery of a manager and everyone below them in the reporting tree, at any depth. */
  teamOf(tenantId: string, managerId: string): SQL {
    return sql`select rc.descendant_id from ${reportingClosure} rc
      where rc.tenant_id = ${tenantId} and rc.ancestor_id = ${managerId}`;
  }

  /** A subquery of the IDs of the users the caller reaches, for other modules' filters. */
  async userIds(tx: TenantTx, access: Access): Promise<SQL> {
    return sql`select ${users.id} from ${users}
      where ${users.tenantId} = ${access.tenantId} and ${await this.users(tx, access)}`;
  }

  /** Whether the caller reaches this user. */
  async reaches(tx: TenantTx, access: Access, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.tenantId, access.tenantId),
          eq(users.id, userId),
          await this.users(tx, access),
        ),
      );
    return row !== undefined;
  }
}
