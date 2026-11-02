import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { OrdersModule } from '../orders/orders.module';
import { SyncModule } from '../sync/sync.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { StockController } from './stock.controller';
import { StockLevelsImport, StockMovementsImport } from './stock.import';
import { StockService } from './stock.service';
import { StockSync } from './stock.sync';
import { StockUpkeep } from './stock.upkeep';

/**
 * Distributors' stock (module M24, BR-62, decision D130): levels, a ledger of movements moved by
 * fulfilment, counts and entries, and loads from the books, behind the opt-in inventory module.
 */
@Module({
  imports: [
    AccountsModule,
    CatalogueModule,
    IamModule,
    ImportsModule,
    OrdersModule,
    SyncModule,
    TenantConfigModule,
  ],
  controllers: [StockController],
  providers: [StockService, StockUpkeep, StockMovementsImport, StockLevelsImport, StockSync],
  exports: [StockService],
})
export class StockModule {}
