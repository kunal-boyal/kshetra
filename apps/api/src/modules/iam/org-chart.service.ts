import { Injectable } from '@nestjs/common';
import type { OrgChartQuery, OrgChartResult } from '@thelamp/shared';
import { and, asc, count, eq, gt, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { designations, reportingClosure, users } from '../../db/schema/iam';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { Scopes } from './scopes';
import { UsersService } from './users.service';

/**
 * The organisation chart (M3), a level at a time: someone's direct reports, or the top of what
 * the caller reaches, each with how many report to them and how many people of each designation
 * work below them. Only active people count, and only those the caller reaches.
 */
@Injectable()
export class OrgChartService {
  constructor(
    private readonly scopes: Scopes,
    private readonly users: UsersService,
  ) {}

  async level(tx: TenantTx, access: Access, query: OrgChartQuery): Promise<OrgChartResult> {
    const tenantId = access.tenantId;
    // Not found, or out of reach.
    if (query.managerId) await this.users.get(tx, access, query.managerId);
    const reach = await this.scopes.users(tx, access);
    const active = and(eq(users.tenantId, tenantId), eq(users.status, 'active'), reach)!;
    // The top of the reach: people whose manager is nobody, or someone the caller doesn't reach.
    const top = or(
      isNull(users.managerId),
      sql`${users.managerId} not in (${await this.scopes.userIds(tx, access)})`,
    );
    const nodes = await tx
      .select({
        id: users.id,
        code: users.code,
        name: users.name,
        designation: designations.key,
        status: users.status,
        managerId: users.managerId,
      })
      .from(users)
      .innerJoin(
        designations,
        and(eq(designations.tenantId, users.tenantId), eq(designations.id, users.designationId)),
      )
      .where(and(active, query.managerId ? eq(users.managerId, query.managerId) : top))
      .orderBy(asc(users.name), asc(users.id));
    const ids = nodes.map((node) => node.id);

    const reports = new Map<string, number>();
    const teams = new Map<string, Record<string, number>>();
    if (ids.length > 0) {
      const direct = await tx
        .select({ managerId: users.managerId, count: count() })
        .from(users)
        .where(and(active, inArray(users.managerId, ids)))
        .groupBy(users.managerId);
      for (const row of direct) reports.set(row.managerId!, row.count);
      for (const row of await this.below(tx, tenantId, active, ids)) {
        teams.set(row.ancestorId, { ...teams.get(row.ancestorId), [row.designation]: row.count });
      }
    }

    let totals: Record<string, number> = {};
    if (query.managerId) {
      for (const row of await this.below(tx, tenantId, active, [query.managerId])) {
        totals[row.designation] = row.count;
      }
    } else {
      const everyone = await tx
        .select({ designation: designations.key, count: count() })
        .from(users)
        .innerJoin(
          designations,
          and(eq(designations.tenantId, users.tenantId), eq(designations.id, users.designationId)),
        )
        .where(active)
        .groupBy(designations.key);
      totals = Object.fromEntries(everyone.map((row) => [row.designation, row.count]));
    }

    return {
      items: nodes.map((node) => ({
        ...node,
        reports: reports.get(node.id) ?? 0,
        team: teams.get(node.id) ?? {},
      })),
      totals,
    };
  }

  /** People below each of `ancestors`, at any depth, by designation. */
  private below(tx: TenantTx, tenantId: string, active: SQL, ancestors: readonly string[]) {
    return tx
      .select({
        ancestorId: reportingClosure.ancestorId,
        designation: designations.key,
        count: count(),
      })
      .from(reportingClosure)
      .innerJoin(
        users,
        and(
          eq(users.tenantId, reportingClosure.tenantId),
          eq(users.id, reportingClosure.descendantId),
        ),
      )
      .innerJoin(
        designations,
        and(eq(designations.tenantId, users.tenantId), eq(designations.id, users.designationId)),
      )
      .where(
        and(
          eq(reportingClosure.tenantId, tenantId),
          inArray(reportingClosure.ancestorId, [...ancestors]),
          gt(reportingClosure.depth, 0),
          active,
        ),
      )
      .groupBy(reportingClosure.ancestorId, designations.key);
  }
}
