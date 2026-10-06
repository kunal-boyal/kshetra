import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { Config } from '../config';
import { AuditLog } from './audit';
import { Database } from './database';
import { Outbox } from './outbox';
import { RateLimiter } from './rate-limit';
import { RedisClient } from './redis';
import { OutboxRelay } from './relay';
import { CONFIG } from './tokens';

/** Settings and shared infrastructure every module can inject. */
@Global()
@Module({})
export class PlatformModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: PlatformModule,
      providers: [
        { provide: CONFIG, useValue: config },
        Database,
        RedisClient,
        RateLimiter,
        AuditLog,
        Outbox,
        OutboxRelay,
      ],
      exports: [CONFIG, Database, RedisClient, RateLimiter, AuditLog, Outbox, OutboxRelay],
    };
  }
}
