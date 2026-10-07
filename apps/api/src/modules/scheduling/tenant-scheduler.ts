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
 * that has come on the tenant's local date. A job's ID is the moment, the tenant and that date, so
 * looking again, or a second scheduler, adds nothing twice.
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

  /** Adds the due moments' jobs for every open tenant on this cell; returns how many came due. */
  async tick(now: Date = new Date()): Promise<number> {
    const moments = this.schedules.tenantMoments;
    if (moments.length === 0) return 0;
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
