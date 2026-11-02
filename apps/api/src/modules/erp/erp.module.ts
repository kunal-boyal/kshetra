import { Module } from '@nestjs/common';
import type { Config } from '../../config';
import { ColumnCipher } from '../../platform/column-cipher';
import { CONFIG } from '../../platform/tokens';
import { AccountsModule } from '../accounts/accounts.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { TerritoriesModule } from '../territories/territories.module';
import { ErpConnectionsService } from './erp-connections.service';
import { ErpController } from './erp.controller';
import { ErpRuns } from './erp-runs';
import { ErpUpkeep } from './erp.upkeep';
import { FakeSapB1 } from './fake-sap-b1';
import { FakeZohoBooks } from './fake-zoho-books';
import { PublicSapTransport, SapB1, SapTransport } from './sap-b1';
import { PublicZohoTransport, ZohoBooks, ZohoTransport } from './zoho-books';

/**
 * ERP connectors (module M20, BR-59, BR-60, decision D129): Zoho Books and SAP Business One. Records come in through
 * the import targets their modules register; nothing here writes another module's tables.
 */
@Module({
  imports: [
    AccountsModule,
    CatalogueModule,
    IamModule,
    ImportsModule,
    NotificationsModule,
    OrdersModule,
    TerritoriesModule,
  ],
  controllers: [ErpController],
  providers: [
    ErpConnectionsService,
    ErpRuns,
    ErpUpkeep,
    ZohoBooks,
    ColumnCipher,
    FakeZohoBooks,
    SapB1,
    FakeSapB1,
    {
      provide: SapTransport,
      inject: [CONFIG, FakeSapB1],
      useFactory: (config: Config, fake: FakeSapB1) =>
        config.SAP_B1_API === 'memory' ? fake : new PublicSapTransport(),
    },
    {
      provide: ZohoTransport,
      inject: [CONFIG, FakeZohoBooks],
      useFactory: (config: Config, fake: FakeZohoBooks) =>
        config.ZOHO_API === 'memory' ? fake : new PublicZohoTransport(),
    },
  ],
  exports: [ErpConnectionsService],
})
export class ErpModule {}
