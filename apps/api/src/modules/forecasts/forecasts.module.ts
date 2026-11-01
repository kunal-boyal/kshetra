import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { ForecastsController } from './forecasts.controller';
import { ForecastsImport } from './forecasts.import';
import { ForecastsService } from './forecasts.service';

/**
 * Product forecasts per account (BR-54, decision D126): each account's expected quantity by item
 * for the coming months, from the phone, the portal, the import and the bulk API.
 */
@Module({
  imports: [AccountsModule, CatalogueModule, IamModule, ImportsModule, TenantConfigModule],
  controllers: [ForecastsController],
  providers: [ForecastsService, ForecastsImport],
  exports: [ForecastsService],
})
export class ForecastsModule {}
