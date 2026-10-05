import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '@kshetra/shared';
import { RedisClient } from './redis';

/** At most `max` hits per `windowSeconds` for one subject, such as a phone number or an address. */
export interface RateLimit {
  name: string;
  max: number;
  windowSeconds: number;
}

// One round trip: count the hit, start the window on the first, and report what is left of it.
const HIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
`;

/**
 * Fixed-window rate limits in Redis (spec 9.2, 11.1). Subjects are hashed, so phone numbers and
 * addresses never sit in Redis as they are.
 */
@Injectable()
export class RateLimiter {
  constructor(private readonly client: RedisClient) {}

  /** Counts one hit, and throws `RATE_LIMITED` with `Retry-After` once the limit is passed. */
  async hit(limit: RateLimit, subject: string): Promise<void> {
    const digest = createHash('sha256').update(subject).digest('hex').slice(0, 32);
    const [count, ttl] = (await this.client.redis.eval(
      HIT,
      1,
      `rl:${limit.name}:${digest}`,
      limit.windowSeconds,
    )) as [number, number];
    if (count > limit.max) {
      throw new AppError(
        'RATE_LIMITED',
        'Too many attempts. Wait a moment, then try again.',
        undefined,
        {
          retryAfterSeconds: Math.max(1, ttl),
        },
      );
    }
  }
}
