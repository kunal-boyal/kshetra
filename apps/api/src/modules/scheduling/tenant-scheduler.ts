import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { momentDue } from '@kshetra/shared';
import type { Config } from '../../config';
import { Database } from '../../platform/database';
import { TenantDirectory } from '../../platform/planes';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { CONFIG } from '../../platform/tokens';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/**
 * The scheduler process (spec 12.3). It puts the interval schedules on their queues once, then
 * every `SCHEDULER_TICK_MS` looks at each open tenant's clock and adds the jobs of every moment
 * that has come on the tenant's local date, and of each tenant interval. A job's ID is the work,
 * the tenant and the date or interval, so looking again, or a second scheduler, adds nothing
 * twice.
 */
@Injectable()
export class TenantScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(TenantScheduler.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly schedules: Schedules,
    private readonly queues: Queues,
    private readonly directory: TenantDirectory,
    private readonly tenantConfig: TenantConfigService,
    private readonly database: Database,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async start(): Promise<void> {
    for (const work of this.schedules.everyIntervals) {
      await this.queues
        .queue(work.queue)
        .upsertJobScheduler(work.id, { every: work.everyMs }, { name: work.kind, data: {} });
    }
    await this.safeTick();
    this.timer = setInterval(() => void this.safeTick(), this.config.SCHEDULER_TICK_MS);
  }

  /**
   * Adds, for every open tenant on this cell, the jobs of the moments that have come on the
   * tenant's local date and of the tenant intervals; returns how many it added.
   */
  async tick(now: Date = new Date()): Promise<number> {
    const moments = this.schedules.tenantMoments;
    const intervals = this.schedules.perTenantIntervals;
    if (moments.length === 0 && intervals.length === 0) return 0;
    let due = 0;
    for (const tenantId of await this.directory.openTenants(this.config.CELL_ID)) {
      const { timezone } = await this.database.forTenant(tenantId, (tx) =>
        this.tenantConfig.settings(tx, tenantId),
      );
      for (const moment of moments) {
        const { due: isDue, date } = momentDue(moment.at, timezone, now);
        if (!isDue) continue;
        // BullMQ keeps colons for its own keys, so the ID uses dots.
        await this.queues.add(
          moment.queue,
          moment.kind,
          { tenantId, date },
          { jobId: `${moment.name}.${tenantId}.${date}` },
        );
        due += 1;
      }
      for (const interval of intervals) {
        const slot = Math.floor(now.getTime() / interval.everyMs);
        await this.queues.add(
          interval.queue,
          interval.kind,
          { tenantId, at: now.toISOString() },
          { jobId: `${interval.name}.${tenantId}.${slot}` },
        );
        due += 1;
      }
    }
    return due;
  }

  private async safeTick(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`The scheduler failed a round: ${(error as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}
