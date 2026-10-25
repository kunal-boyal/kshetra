import { Injectable } from '@nestjs/common';
import { RedisClient } from './redis';

/** Counts live past the month they count, long enough for its usage to be read again. */
const KEEP_SECONDS = 100 * 86_400;

/**
 * API calls per tenant and month (M22, decision D89), counted in Redis as requests arrive: a hash
 * a month, a field a tenant. Counting never holds a request up, and a lost count costs little.
 */
@Injectable()
export class ApiCalls {
  constructor(private readonly client: RedisClient) {}

  count(tenantId: string, at = new Date()): void {
    const key = `usage:api:${at.toISOString().slice(0, 7)}`;
    void this.client.redis
      .multi()
      .hincrby(key, tenantId, 1)
      .expire(key, KEEP_SECONDS)
      .exec()
      .catch(() => undefined);
  }

  async read(tenantId: string, period: string): Promise<number> {
    return Number((await this.client.redis.hget(`usage:api:${period}`, tenantId)) ?? 0);
  }
}
