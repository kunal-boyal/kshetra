import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Config } from './config';
import { DirectoryHealth, DirectoryModule } from './modules/directory/directory.module';
import { AuditModule } from './modules/audit/audit.module';
import { ConfigBundleModule } from './modules/config-bundle/config-bundle.module';
import { IamModule } from './modules/iam/iam.module';
import { ProvisioningModule } from './modules/provisioning/provisioning.module';
import { TenantConfigModule } from './modules/tenant-config/tenant-config.module';
import { TerritoriesModule } from './modules/territories/territories.module';
import { PlanesModule } from './planes.module';
import { AppVersionGuard } from './platform/app-version';
import { AccessTokens, AuthGuard } from './platform/auth';
import { Database } from './platform/database';
import { HEALTH_CHECKS, HealthController, type HealthChecks } from './platform/health.controller';
import { PlatformModule } from './platform/platform.module';
import { RedisClient } from './platform/redis';

@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot(config),
        PlanesModule,
        DirectoryModule,
        IamModule,
        TerritoriesModule,
        TenantConfigModule,
        ConfigBundleModule,
        AuditModule,
        ProvisioningModule,
      ],
      controllers: [HealthController],
      providers: [
        AccessTokens,
        // Guards run in this order: an outdated app hears that first, then every route needs an
        // access token unless it is marked @Public().
        { provide: APP_GUARD, useClass: AppVersionGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: HEALTH_CHECKS,
          inject: [Database, DirectoryHealth, RedisClient],
          useFactory: (
            database: Database,
            directory: DirectoryHealth,
            redis: RedisClient,
          ): HealthChecks => ({
            database: () => database.ping(),
            directory: () => directory.ping(),
            redis: () => redis.ping(),
          }),
        },
      ],
    };
  }
}
