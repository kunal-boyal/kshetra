import { Injectable } from '@nestjs/common';
import { periodDays, type TenantUsageResult, type UsageMetric } from '@thelamp/shared';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { memberships, refreshTokens, usageRecords } from '../../db/schema/directory';
import { UsageRecorder } from '../../platform/planes';
import { DirectoryDatabase } from '../directory/directory.database';

/**
 * Metered usage (M22, decision D89): each tenant's month, kept current through the month. The
 * cell sends what it measures; the directory adds the people who signed in, which only it sees.
 */
@Injectable()
export class UsageService extends UsageRecorder {
  constructor(private readonly database: DirectoryDatabase) {
    super();
  }

  async record(
    tenantId: string,
    period: string,
    metrics: Partial<Record<UsageMetric, string>>,
  ): Promise<void> {
    const all = { ...metrics, active_users: String(await this.activeUsers(tenantId, period)) };
    const rows = Object.entries(all).map(([metric, quantity]) => ({
      tenantId,
      period,
      metric,
      quantity,
      updatedAt: new Date(),
    }));
    await this.database.db
      .insert(usageRecords)
      .values(rows)
      .onConflictDoUpdate({
        target: [usageRecords.tenantId, usageRecords.period, usageRecords.metric],
        set: { quantity: sql`excluded.quantity`, updatedAt: sql`excluded.updated_at` },
      });
  }

  /** The tenant's last `months` months, newest first. */
  async forTenant(tenantId: string, months: number): Promise<TenantUsageResult> {
    const periods = lastPeriods(months);
    const rows = await this.database.db
      .select()
      .from(usageRecords)
      .where(and(eq(usageRecords.tenantId, tenantId), inArray(usageRecords.period, periods)))
      .orderBy(desc(usageRecords.period));
    const byPeriod = new Map<string, { metrics: Record<string, string>; updatedAt: Date }>();
    for (const row of rows) {
      const entry = byPeriod.get(row.period) ?? { metrics: {}, updatedAt: row.updatedAt };
      entry.metrics[row.metric] = row.quantity;
      if (row.updatedAt > entry.updatedAt) entry.updatedAt = row.updatedAt;
      byPeriod.set(row.period, entry);
    }
    return {
      items: [...byPeriod].map(([period, { metrics, updatedAt }]) => ({
        period,
        metrics,
        updatedAt: updatedAt.toISOString(),
      })),
    };
  }

  /** People who signed in or refreshed a session in the month. */
  private async activeUsers(tenantId: string, period: string): Promise<number> {
    const { start, end } = periodDays(period);
    const until = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000);
    const [row] = await this.database.db
      .select({ count: sql<number>`count(distinct ${memberships.userId})::int` })
      .from(refreshTokens)
      .innerJoin(memberships, eq(memberships.id, refreshTokens.membershipId))
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          gte(refreshTokens.createdAt, new Date(`${start}T00:00:00Z`)),
          lt(refreshTokens.createdAt, until),
        ),
      );
    return row?.count ?? 0;
  }
}

/** This month and the `count - 1` before it, as `YYYY-MM`. */
function lastPeriods(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, back) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7),
  );
}
