import { Injectable } from '@nestjs/common';
import { todayIn } from '@thelamp/shared';
import { and, asc, eq, or, type SQL, sql } from 'drizzle-orm';
import { reportingClosure, roles, users } from '../../db/schema/iam';
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

  /**
   * The active holders of a role whose data scope reaches a person, in code order: who decides an
   * approval step routed to a role (spec 5.9, `role_in_scope`), or escalated to one.
   */
  async holdersReaching(
    tx: TenantTx,
    tenantId: string,
    roleKey: string,
    userId: string,
  ): Promise<string[]> {
    const holders = await tx
      .select({ id: users.id, scope: roles.scope })
      .from(users)
      .innerJoin(roles, and(eq(roles.tenantId, users.tenantId), eq(roles.id, users.roleId)))
      .where(and(eq(users.tenantId, tenantId), eq(users.status, 'active'), eq(roles.key, roleKey)))
      .orderBy(asc(users.code));
    if (holders.length === 0) return [];
    const above = new Set(
      (
        await tx
          .select({ id: reportingClosure.ancestorId })
          .from(reportingClosure)
          .where(
            and(eq(reportingClosure.tenantId, tenantId), eq(reportingClosure.descendantId, userId)),
          )
      ).map((row) => row.id),
    );
    const { timezone } = await this.config.settings(tx, tenantId);
    const today = todayIn(timezone);
    const reached: string[] = [];
    for (const holder of holders) {
      const team = above.has(holder.id);
      const territory = async () => {
        const result = await tx.execute<{ hit: number }>(
          sql`select 1 as hit where ${userId}::uuid in (${this.territories.usersReachedBy(tenantId, holder.id, today)})`,
        );
        return result.rows.length > 0;
      };
      const reaches =
        holder.scope === 'tenant' ||
        (holder.scope === 'self' && holder.id === userId) ||
        (holder.scope === 'team' && team) ||
        (holder.scope === 'territory' && (holder.id === userId || (await territory()))) ||
        (holder.scope === 'team_or_territory' && (team || (await territory())));
      if (reaches) reached.push(holder.id);
    }
    return reached;
  }
}
