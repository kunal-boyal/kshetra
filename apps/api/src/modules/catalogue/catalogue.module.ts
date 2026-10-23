import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { ImportsModule } from '../imports/imports.module';
import { SyncModule } from '../sync/sync.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TerritoriesModule } from '../territories/territories.module';
import { CatalogueController, ItemsController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';
import { ItemsImport } from './items.import';
import { ItemsService } from './items.service';
import { ItemsSync } from './items.sync';
import { AccountPricesController, PriceListsController } from './price-lists.controller';
import { PriceListsService } from './price-lists.service';

/** Catalogue settings, categories, products, items and price lists (spec 5.11, 9.6). */
@Module({
  imports: [ImportsModule, TenantConfigModule, SyncModule, AccountsModule, TerritoriesModule],
  controllers: [
    CatalogueController,
    ItemsController,
    PriceListsController,
    AccountPricesController,
  ],
  providers: [CatalogueService, ItemsService, PriceListsService, ItemsImport, ItemsSync],
  exports: [CatalogueService, ItemsService, PriceListsService],
})
export class CatalogueModule {}
