import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { Config } from '../config';
import { ApiCalls } from './api-calls';
import { HealthCounters } from './health-counters';
import { AuditLog } from './audit';
import { BreachedPasswords, createBreachedPasswords } from './breached-passwords';
import { Database } from './database';
import { createObjectStore, ObjectStore } from './object-store';
import { Outbox } from './outbox';
import { Queues } from './queues';
import { RateLimiter } from './rate-limit';
import { ApiClientLimits } from './api-client-limits';
import { RedisClient } from './redis';
import { OutboxRelay } from './relay';
import { Schedules } from './schedules';
import { TenantSlots } from './tenant-slots';
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
        ApiClientLimits,
        ApiCalls,
        HealthCounters,
        AuditLog,
        Outbox,
        OutboxRelay,
        TenantSlots,
        Queues,
        Schedules,
        { provide: ObjectStore, useFactory: () => createObjectStore(config) },
        { provide: BreachedPasswords, useFactory: () => createBreachedPasswords(config) },
      ],
      exports: [
        CONFIG,
        Database,
        RedisClient,
        RateLimiter,
        ApiClientLimits,
        ApiCalls,
        HealthCounters,
        AuditLog,
        Outbox,
        OutboxRelay,
        TenantSlots,
        Queues,
        Schedules,
        ObjectStore,
        BreachedPasswords,
      ],
    };
  }
}
