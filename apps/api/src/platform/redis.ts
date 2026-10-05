import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Config } from '../config';
import { CONFIG } from './tokens';

/**
 * The cell's Redis (spec 9.2): rate limits now, then caches and queues. Keys carry the product
 * slug as a prefix. A command fails fast instead of queueing while Redis is down, so a request
 * errors rather than hangs.
 */
@Injectable()
export class RedisClient implements OnModuleDestroy {
  private readonly logger = new Logger(RedisClient.name);
  readonly redis: Redis;

  constructor(@Inject(CONFIG) config: Config) {
    this.redis = new Redis(config.REDIS_URL, {
      keyPrefix: `${config.PRODUCT_SLUG}:`,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
    });
    // Without a listener, ioredis reports every failed reconnect as an unhandled error.
    this.redis.on('error', (error: Error) => this.logger.warn(`Redis: ${error.message}`));
  }

  /** For readiness: does Redis answer within a second? */
  async ping(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), 1_000);
    });
    try {
      return await Promise.race([this.redis.ping().then(() => true), timeout]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
