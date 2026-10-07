import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Config } from '../config';
import { Database } from './database';
import { Outbox } from './outbox';
import { Queues } from './queues';
import { Schedules } from './schedules';
import { CONFIG } from './tokens';

const HOUSEKEEPING_MS = 60 * 60_000;

/**
 * The outbox relay (spec 12.3): delivers events that are due again after a failure, or that no
 * process delivered after commit. The worker process runs it; several processes may, since each
 * event is locked while one of them delivers it. Once an hour, a maintenance job creates the
 * coming months' audit partitions and purges what retention allows.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly database: Database,
    private readonly outbox: Outbox,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  onModuleInit(): void {
    this.queues.handle('maintenance', 'housekeeping', () => this.housekeeping());
    this.schedules.every({
      id: 'housekeeping',
      everyMs: HOUSEKEEPING_MS,
      queue: 'maintenance',
      kind: 'housekeeping',
    });
  }

  onApplicationBootstrap(): void {
    if (this.config.OUTBOX_RELAY) this.schedule();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Delivers up to `batch` due events; returns how many were delivered. */
  async runOnce(batch = 100): Promise<number> {
    const due = await this.database.db.execute<{ tenant_id: string; id: string }>(
      sql`select tenant_id, id from cell.due_outbox_events(${batch})`,
    );
    let delivered = 0;
    for (const event of due.rows) {
      if (await this.outbox.deliver(event.tenant_id, event.id)) delivered += 1;
    }
    return delivered;
  }

  /** Audit partitions for the coming months, and the purges retention allows (D32). */
  async housekeeping(): Promise<void> {
    await this.database.db.execute(sql`select cell.ensure_audit_log_partitions()`);
    await this.database.db.execute(sql`select cell.purge_outbox_and_idempotency_keys()`);
  }

  private schedule(): void {
    this.timer = setTimeout(() => void this.tick(), this.config.OUTBOX_POLL_MS);
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.warn(`The outbox relay failed a round: ${(error as Error).message}`);
    } finally {
      if (!this.stopped) this.schedule();
    }
  }
}
