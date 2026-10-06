import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { reportingClosure } from '../../db/schema/iam';
import type { TenantTx } from '../../platform/database';

/**
 * Keeps `reporting_closure` in step with `users.manager_id`. Its rows are derived data, so moving
 * someone deletes and rewrites them.
 */
@Injectable()
export class ReportingTree {
  /**
   * Changes to one tenant's reporting tree take turns, until the transaction ends, so two moves at
   * once cannot close a loop between them.
   */
  async lock(tx: TenantTx, tenantId: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`reporting:${tenantId}`}, 0))`,
    );
  }

  /** A new user: paired with themselves, and below their manager and everyone above them. */
  async add(tx: TenantTx, tenantId: string, userId: string, managerId: string | null) {
    await tx.execute(sql`
      insert into ${reportingClosure} (tenant_id, ancestor_id, descendant_id, depth)
      select ${tenantId}::uuid, ${userId}::uuid, ${userId}::uuid, 0
      union all
      select tenant_id, ancestor_id, ${userId}::uuid, depth + 1
        from ${reportingClosure}
       where tenant_id = ${tenantId} and descendant_id = ${managerId}`);
  }

  /** True when `userId` is `ancestorId` or reports to them at any depth. */
  async isUnder(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    ancestorId: string,
  ): Promise<boolean> {
    const result = await tx.execute<{ under: boolean }>(sql`
      select exists (
        select 1 from ${reportingClosure}
         where tenant_id = ${tenantId} and ancestor_id = ${ancestorId} and descendant_id = ${userId}
      ) as under`);
    return result.rows[0]?.under === true;
  }

  /** Moves a user and everyone below them under a new manager, or to the top. */
  async move(tx: TenantTx, tenantId: string, userId: string, managerId: string | null) {
    // Cut every path from above the user to anyone in their subtree...
    await tx.execute(sql`
      delete from ${reportingClosure} link
       using ${reportingClosure} below, ${reportingClosure} above
       where link.tenant_id = ${tenantId}
         and below.tenant_id = ${tenantId} and below.ancestor_id = ${userId}
         and above.tenant_id = ${tenantId} and above.descendant_id = ${userId}
         and above.ancestor_id <> ${userId}
         and link.ancestor_id = above.ancestor_id
         and link.descendant_id = below.descendant_id`);
    // ...then join the subtree below the new manager and everyone above them.
    await tx.execute(sql`
      insert into ${reportingClosure} (tenant_id, ancestor_id, descendant_id, depth)
      select ${tenantId}::uuid, above.ancestor_id, below.descendant_id, above.depth + below.depth + 1
        from ${reportingClosure} above, ${reportingClosure} below
       where above.tenant_id = ${tenantId} and above.descendant_id = ${managerId}
         and below.tenant_id = ${tenantId} and below.ancestor_id = ${userId}`);
  }
}
