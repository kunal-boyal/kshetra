import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Config } from './config';
import { AccountsModule } from './modules/accounts/accounts.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { FieldModule } from './modules/field/field.module';
import { DirectoryHealth, DirectoryModule } from './modules/directory/directory.module';
import { AuditModule } from './modules/audit/audit.module';
import { ConfigBundleModule } from './modules/config-bundle/config-bundle.module';
import { FormsModule } from './modules/forms/forms.module';
import { IamModule } from './modules/iam/iam.module';
import { ImportsModule } from './modules/imports/imports.module';
import { MediaModule } from './modules/media/media.module';
import { PhotosModule } from './modules/media/photos.module';
import { ProvisioningModule } from './modules/provisioning/provisioning.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { SyncModule } from './modules/sync/sync.module';
import { TenantConfigModule } from './modules/tenant-config/tenant-config.module';
import { TerritoriesModule } from './modules/territories/territories.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { PlanesModule } from './planes.module';
import { AppVersionGuard } from './platform/app-version';
import { AccessTokens, AuthGuard } from './platform/auth';
import { Database } from './platform/database';
import { HEALTH_CHECKS, HealthController, type HealthChecks } from './platform/health.controller';
import { PlatformModule } from './platform/platform.module';
import { RedisClient } from './platform/redis';
import { controllersOf } from './platform/routes';

/** The feature modules. The route registry reads their controllers without starting the app. */
export const FEATURE_MODULES = [
  PlanesModule,
  DirectoryModule,
  IamModule,
  TerritoriesModule,
  TenantConfigModule,
  ConfigBundleModule,
  AuditModule,
  ProvisioningModule,
  SchedulingModule,
  SyncModule,
  MediaModule,
  PhotosModule,
  ImportsModule,
  WorkflowModule,
  AccountsModule,
  CatalogueModule,
  FormsModule,
  FieldModule,
];

/** Every controller the API serves: the health checks and each feature module's. */
export function apiControllers(): Type[] {
  return [HealthController, ...controllersOf(FEATURE_MODULES)];
}

@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [PlatformModule.forRoot(config), ...FEATURE_MODULES],
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
