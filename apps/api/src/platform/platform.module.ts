import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { Config } from '../config';
import { ApiCalls } from './api-calls';
import { AuditLog } from './audit';
import { Database } from './database';
import { createObjectStore, ObjectStore } from './object-store';
import { Outbox } from './outbox';
import { Queues } from './queues';
import { RateLimiter } from './rate-limit';
import { RedisClient } from './redis';
import { OutboxRelay } from './relay';
import { Schedules } from './schedules';
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
        ApiCalls,
        AuditLog,
        Outbox,
        OutboxRelay,
        Queues,
        Schedules,
        { provide: ObjectStore, useFactory: () => createObjectStore(config) },
      ],
      exports: [
        CONFIG,
        Database,
        RedisClient,
        RateLimiter,
        ApiCalls,
        AuditLog,
        Outbox,
        OutboxRelay,
        Queues,
        Schedules,
        ObjectStore,
      ],
    };
  }
}
