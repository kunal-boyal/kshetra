import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { CellFiguresShape, QueueFiguresShape } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import type { Config } from '../../config';
import { Database } from '../../platform/database';
import { HealthCounters, minuteOf } from '../../platform/health-counters';
import { CellHealthRecorder } from '../../platform/planes';
import { QUEUE_NAMES, Queues } from '../../platform/queues';
import { CONFIG } from '../../platform/tokens';

const MINUTE_MS = 60_000;

interface Facts extends Record<string, unknown> {
  outbox_backlog: number;
  outbox_oldest_seconds: number | null;
  phones_seen: number;
  phones_waiting: number;
  phones_parked: number;
  phones_oldest_queued_seconds: number | null;
}

/**
 * The cell's health (module M22, spec 14.6, decision D93), reported by its scheduler process
 * each minute for the minute just gone, outside the queues so a backlog can't delay it: requests
 * and server errors, points accepted and late, each queue's depth and oldest wait, the outbox's
 * backlog, and phones' uploads waiting. A second scheduler reports the same minute, which the
 * directory keeps once.
 */
@Injectable()
export class CellHealthReporter implements OnModuleDestroy {
  private readonly logger = new Logger(CellHealthReporter.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly counters: HealthCounters,
    private readonly queues: Queues,
    private readonly database: Database,
    private readonly recorder: CellHealthRecorder,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      this.report().catch((error: unknown) =>
        this.logger.warn(`Could not report the cell's health: ${(error as Error).message}`),
      );
    }, MINUTE_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Measures and reports the minute before `now`. */
  async report(now: Date = new Date()): Promise<CellFiguresShape> {
    const minute = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS - MINUTE_MS);
    const figures = await this.measure(minute, now);
    await this.recorder.record(this.config.CELL_ID, minute, figures);
    return figures;
  }

  async measure(minute: Date, now: Date): Promise<CellFiguresShape> {
    const [counts, queues, facts] = await Promise.all([
      this.counters.read(minuteOf(minute)),
      this.queueFigures(now),
      this.database.db.execute<Facts>(sql`select * from cell.health_facts()`),
    ]);
    const row = facts.rows[0];
    return {
      ...counts,
      queues,
      outbox: {
        backlog: Number(row?.outbox_backlog ?? 0),
        oldestSeconds: row?.outbox_oldest_seconds ?? null,
      },
      phones: {
        seen: Number(row?.phones_seen ?? 0),
        waiting: Number(row?.phones_waiting ?? 0),
        parked: Number(row?.phones_parked ?? 0),
        oldestQueuedSeconds: row?.phones_oldest_queued_seconds ?? null,
      },
    };
  }

  private async queueFigures(now: Date): Promise<Record<string, QueueFiguresShape>> {
    const figures: Record<string, QueueFiguresShape> = {};
    for (const name of QUEUE_NAMES) {
      const queue = this.queues.queue(name);
      const counts = await queue.getJobCounts('wait', 'active', 'delayed', 'failed');
      // The oldest waiting job comes first when read oldest first.
      const [oldest] = await queue.getJobs(['wait'], 0, 0, true);
      figures[name] = {
        waiting: counts.wait ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        oldestWaitSeconds: oldest
          ? Math.max(0, Math.round((now.getTime() - oldest.timestamp) / 1000))
          : null,
      };
    }
    return figures;
  }
}
