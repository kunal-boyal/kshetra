import { Injectable } from '@nestjs/common';
import { calculateDayFacts } from '@thelamp/metrics';
import { todayIn } from '@thelamp/shared';
import { and, eq, sql } from 'drizzle-orm';
import { metricFactAccounts, metricFactsDaily } from '../../db/schema/metrics';
import type { TenantTx } from '../../platform/database';
import { SubmissionsService } from '../field/submissions.service';
import { VisitsService } from '../field/visits.service';
import { MetricsService } from '../metrics/metrics.service';
import { PlanningService } from '../planning/planning.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/**
 * The metric engine (spec 12.5, decision D56): one person's day, recomputed from its source
 * records into `metric_facts_daily` and, for distinct counts, `metric_fact_accounts`. Recomputing
 * replaces the day's facts, so running it again changes nothing.
 */
@Injectable()
export class MetricsEngine {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: TenantConfigService,
    private readonly submissions: SubmissionsService,
    private readonly visits: VisitsService,
    private readonly planning: PlanningService,
  ) {}

  /** Recomputes every metric for one person and date on the tenant's clock. */
  async recompute(tx: TenantTx, tenantId: string, userId: string, date: string): Promise<void> {
    // Two recomputes of one day take turns, so neither inserts over the other's rows.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`metrics:${tenantId}:${userId}:${date}`}, 0))`,
    );
    const definitions = await this.metrics.definitions(tx, tenantId);
    const { timezone } = await this.config.settings(tx, tenantId);
    const submissions = await this.submissions.forMetrics(tx, tenantId, userId, date, timezone);
    const visits = await this.visits.forMetrics(tx, tenantId, userId, date, timezone);
    const planItems = await this.planning.forMetrics(tx, tenantId, userId, date);
    const facts = calculateDayFacts(definitions, {
      date,
      today: todayIn(timezone),
      submissions,
      visits,
      planItems,
    });
    const day = and(
      eq(metricFactsDaily.tenantId, tenantId),
      eq(metricFactsDaily.userId, userId),
      eq(metricFactsDaily.date, date),
    );
    await tx.delete(metricFactsDaily).where(day);
    await tx
      .delete(metricFactAccounts)
      .where(
        and(
          eq(metricFactAccounts.tenantId, tenantId),
          eq(metricFactAccounts.userId, userId),
          eq(metricFactAccounts.date, date),
        ),
      );
    // A day with nothing in it keeps no rows: periods read missing days as zero.
    const kept = facts.filter(
      (fact) =>
        fact.value !== '0.000' ||
        (fact.pending !== null && fact.pending !== '0.000') ||
        (fact.denominator !== null && fact.denominator !== '0.000'),
    );
    if (kept.length > 0) {
      await tx.insert(metricFactsDaily).values(
        kept.map((fact) => ({
          tenantId,
          userId,
          date,
          metricKey: fact.key,
          value: fact.value,
          numerator: fact.numerator,
          denominator: fact.denominator,
          pending: fact.pending,
        })),
      );
    }
    const accounts = facts.flatMap((fact) =>
      fact.accounts.map((accountId) => ({
        tenantId,
        userId,
        date,
        metricKey: fact.key,
        accountId,
      })),
    );
    if (accounts.length > 0) await tx.insert(metricFactAccounts).values(accounts);
  }
}
