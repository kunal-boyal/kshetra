import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { ConfigBundleController } from './config-bundle.controller';

/**
 * Assembles the config bundle from the modules that own its parts (spec 9.6, 11.2). It sits above
 * them, so none of them depends on another to build it.
 */
@Module({ imports: [TenantConfigModule, IamModule], controllers: [ConfigBundleController] })
export class ConfigBundleModule {}
