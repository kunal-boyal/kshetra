import { Injectable } from '@nestjs/common';
import { RedisClient } from './redis';

// One round trip: drop holders whose time is up, then take a slot if one is free or already held.
const TAKE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZSCORE', KEYS[1], ARGV[3]) or redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[4]) then
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
  redis.call('PEXPIRE', KEYS[1], ARGV[5])
  return 1
end
return 0
`;

/**
 * How many heavy jobs each tenant runs at once on a queue (spec 10.3, decision D98): a sorted set
 * per queue and tenant in Redis, holding each running job until it ends, or until its hold runs
 * out if its worker died, so a lost slot frees itself.
 */
@Injectable()
export class TenantSlots {
  constructor(private readonly client: RedisClient) {}

  /** Takes one of `limit` slots for the job; false when the tenant's are all in use. */
  async take(
    queue: string,
    tenantId: string,
    jobId: string,
    limit: number,
    holdMs: number,
    now = Date.now(),
  ): Promise<boolean> {
    const taken = await this.client.redis.eval(
      TAKE,
      1,
      key(queue, tenantId),
      now,
      now + holdMs,
      jobId,
      limit,
      holdMs,
    );
    return taken === 1;
  }

  async release(queue: string, tenantId: string, jobId: string): Promise<void> {
    await this.client.redis.zrem(key(queue, tenantId), jobId);
  }
}

const key = (queue: string, tenantId: string) => `slots:${queue}:${tenantId}`;
