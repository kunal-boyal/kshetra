import { Module } from '@nestjs/common';
import type { Config } from '../../config';
import { ColumnCipher } from '../../platform/column-cipher';
import { CONFIG } from '../../platform/tokens';
import { AccountsModule } from '../accounts/accounts.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TerritoriesModule } from '../territories/territories.module';
import { ErpConnectionsService } from './erp-connections.service';
import { ErpController } from './erp.controller';
import { ErpRuns } from './erp-runs';
import { ErpUpkeep } from './erp.upkeep';
import { FakeSapB1 } from './fake-sap-b1';
import { FakeZohoBooks } from './fake-zoho-books';
import { PublicSapTransport, SapB1, SapTransport } from './sap-b1';
import { TallyReads } from './tally-runs';
import { PublicZohoTransport, ZohoBooks, ZohoTransport } from './zoho-books';

/**
 * ERP connectors (module M20, BR-59 to BR-61, decision D129): Zoho Books, SAP Business One and
 * Tally. Records come in through the import targets their modules register; nothing here writes
 * another module's tables.
 */
@Module({
  imports: [
    AccountsModule,
    CatalogueModule,
    IamModule,
    ImportsModule,
    MediaModule,
    NotificationsModule,
    OrdersModule,
    TenantConfigModule,
    TerritoriesModule,
  ],
  controllers: [ErpController],
  providers: [
    ErpConnectionsService,
    ErpRuns,
    ErpUpkeep,
    TallyReads,
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
