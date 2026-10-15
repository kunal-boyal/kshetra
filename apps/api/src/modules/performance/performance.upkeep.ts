import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type EventPayload, monthOf, todayIn } from '@kshetra/shared';
import { sql } from 'drizzle-orm';
import { Database, type TenantTx } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { People } from '../iam/people';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { MetricsEngine } from './metrics-engine';
import { PerformanceService } from './performance.service';

/** The day before a `YYYY-MM-DD`. */
function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Keeps the metric engine's facts current (spec 12.5, decision D56):
 * - a submission received or reviewed, a visit ended or a plan item moved recomputes the
 *   person's day it belongs to (BR-03), in the consumer's transaction;
 * - just after midnight on each tenant's clock, everyone's day just gone is recomputed, so plan
 *   items falling due are counted, and the month's scores and ranks are kept for history.
 */
@Injectable()
export class PerformanceUpkeep implements OnModuleInit {
  constructor(
    private readonly database: Database,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    private readonly outbox: Outbox,
    private readonly config: TenantConfigService,
    private readonly people: People,
    private readonly engine: MetricsEngine,
    private readonly performance: PerformanceService,
  ) {}

  /** Recomputes the day a moment falls on, on the tenant's clock. */
  private async at(tx: TenantTx, tenantId: string, userId: string, moment: string) {
    const { timezone } = await this.config.settings(tx, tenantId);
    await this.engine.recompute(tx, tenantId, userId, todayIn(timezone, new Date(moment)));
  }

  /** Everyone's day just gone, and the month's scores as they stand. */
  async nightly(tenantId: string): Promise<void> {
    await this.database.forTenant(tenantId, async (tx) => {
      const { timezone } = await this.config.settings(tx, tenantId);
      const yesterday = dayBefore(todayIn(timezone));
      for (const person of await this.people.matching(tx, tenantId, sql`true`)) {
        await this.engine.recompute(tx, tenantId, person.id, yesterday);
      }
      await this.performance.snapshot(tx, tenantId, monthOf(yesterday));
    });
  }

  onModuleInit(): void {
    this.outbox.consume(
      ['submission.created', 'submission.reviewed'],
      'performance.submissions',
      async (event, tx) => {
        const payload = event.payload as EventPayload<'submission.created'>;
        await this.at(tx, event.tenantId, payload.userId, payload.capturedAt);
      },
    );
    this.outbox.consume(['visit.ended'], 'performance.visits', async (event, tx) => {
      const payload = event.payload as EventPayload<'visit.ended'>;
      await this.at(tx, event.tenantId, payload.userId, payload.checkInAt);
    });
    this.outbox.consume(['plan_item.status_changed'], 'performance.plan', async (event, tx) => {
      const payload = event.payload as EventPayload<'plan_item.status_changed'>;
      await this.engine.recompute(tx, event.tenantId, payload.userId, payload.date);
    });
    this.queues.handle('maintenance', 'performance.nightly', (data) =>
      this.nightly(String(data.tenantId)),
    );
    this.schedules.atTenantTime({
      name: 'performance',
      at: '00:20',
      queue: 'maintenance',
      kind: 'performance.nightly',
    });
  }
}
