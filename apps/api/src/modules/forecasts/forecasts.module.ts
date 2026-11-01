import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { SyncModule } from '../sync/sync.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { ForecastsController } from './forecasts.controller';
import { ForecastsImport } from './forecasts.import';
import { ForecastsService } from './forecasts.service';
import { ForecastsSync } from './forecasts.sync';

/**
 * Product forecasts per account (BR-54, decision D126): each account's expected quantity by item
 * for the coming months, from the phone, the portal, the import and the bulk API.
 */
@Module({
  imports: [
    AccountsModule,
    CatalogueModule,
    IamModule,
    ImportsModule,
    SyncModule,
    TenantConfigModule,
  ],
  controllers: [ForecastsController],
  providers: [ForecastsService, ForecastsImport, ForecastsSync],
  exports: [ForecastsService],
})
export class ForecastsModule {}
