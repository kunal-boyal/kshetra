import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '../config';
import { RedisClient } from './redis';
import { CONFIG } from './tokens';

/** A minute's counts are read once the minute is over, so they need not last long. */
const KEEP_SECONDS = 60 * 60;

/** The minute a moment falls in, as its counts are keyed: `YYYY-MM-DDTHH:MM`. */
export const minuteOf = (at: Date) => at.toISOString().slice(0, 16);

/** One minute's counts of a cell. */
export interface MinuteCounts {
  requests: number;
  errors: number;
  points: number;
  latePoints: number;
}

/**
 * The cell's health counts (decision D93), kept in Redis a minute at a time as requests are
 * answered and points arrive: a hash a minute, shared by every API process of the cell. Counting
 * never holds a request up, and a lost count costs little.
 */
@Injectable()
export class HealthCounters {
  constructor(
    private readonly client: RedisClient,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** A request answered with `status`; 5xx counts as an error. */
  request(status: number, at = new Date()): void {
    this.add({ requests: 1, ...(status >= 500 ? { errors: 1 } : {}) }, at);
  }

  /** Points accepted, and how many of them arrived late. */
  points(accepted: number, late: number, at = new Date()): void {
    if (accepted > 0) this.add({ points: accepted, latePoints: late }, at);
  }

  async read(minute: string): Promise<MinuteCounts> {
    const counts = await this.client.redis.hgetall(this.key(minute));
    const number = (field: keyof MinuteCounts) => Number(counts[field] ?? 0);
    return {
      requests: number('requests'),
      errors: number('errors'),
      points: number('points'),
      latePoints: number('latePoints'),
    };
  }

  private add(counts: Partial<MinuteCounts>, at: Date): void {
    const key = this.key(minuteOf(at));
    const multi = this.client.redis.multi();
    for (const [field, value] of Object.entries(counts)) multi.hincrby(key, field, value);
    void multi
      .expire(key, KEEP_SECONDS)
      .exec()
      .catch(() => undefined);
  }

  private key(minute: string): string {
    return `health:${this.config.CELL_ID}:${minute}`;
  }
}
