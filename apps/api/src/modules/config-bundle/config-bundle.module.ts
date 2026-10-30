import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { FormsModule } from '../forms/forms.module';
import { IamModule } from '../iam/iam.module';
import { MetricsModule } from '../metrics/metrics.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { ConfigBundleController } from './config-bundle.controller';

/**
 * Assembles the config bundle from the modules that own its parts (spec 9.6, 11.2). It sits above
 * them, so none of them depends on another to build it.
 */
@Module({
  imports: [
    TenantConfigModule,
    IamModule,
    AccountsModule,
    FormsModule,
    CatalogueModule,
    MetricsModule,
  ],
  controllers: [ConfigBundleController],
})
export class ConfigBundleModule {}
