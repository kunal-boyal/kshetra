import { Injectable } from '@nestjs/common';
import { and, eq, or, type SQL, sql } from 'drizzle-orm';
import { reportingClosure, users } from '../../db/schema/iam';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { TerritoriesService } from '../territories/territories.service';

/**
 * Whose records a caller's data scope reaches (spec 4.2). Every scope reaches the caller; `team`
 * adds everyone below them in the reporting tree, `territory` everyone attached at or below their
 * territories, and `tenant` everyone. Later modules filter their records with the same conditions.
 */
@Injectable()
export class Scopes {
  constructor(private readonly territories: TerritoriesService) {}

  /** A condition on `users` that holds for the users the caller reaches. */
  users(access: Access): SQL {
    const self = eq(users.id, access.userId);
    // The closure pairs each user with themselves at depth 0, so a team includes its manager.
    const team = sql`exists (
      select 1 from ${reportingClosure} rc
       where rc.tenant_id = ${users.tenantId}
         and rc.ancestor_id = ${access.userId}
         and rc.descendant_id = ${users.id})`;
    const territory = sql`${users.id} in (${this.territories.usersReachedBy(access.tenantId, access.userId)})`;
    switch (access.scope) {
      case 'self':
        return self;
      case 'team':
        return team;
      case 'territory':
        return or(self, territory)!;
      case 'team_or_territory':
        return or(team, territory)!;
      case 'tenant':
        return sql`true`;
    }
  }

  /** Whether the caller reaches this user. */
  async reaches(tx: TenantTx, access: Access, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, access.tenantId), eq(users.id, userId), this.users(access)));
    return row !== undefined;
  }
}
