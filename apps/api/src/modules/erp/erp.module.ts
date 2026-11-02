import { Module } from '@nestjs/common';
import type { Config } from '../../config';
import { ColumnCipher } from '../../platform/column-cipher';
import { CONFIG } from '../../platform/tokens';
import { AccountsModule } from '../accounts/accounts.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { TerritoriesModule } from '../territories/territories.module';
import { ErpConnectionsService } from './erp-connections.service';
import { ErpController } from './erp.controller';
import { ErpPull } from './erp-pull';
import { ErpUpkeep } from './erp.upkeep';
import { FakeZohoBooks } from './fake-zoho-books';
import { PublicZohoTransport, ZohoBooks, ZohoTransport } from './zoho-books';

/**
 * ERP connectors (module M20, BR-59, decision D129): Zoho Books first. Records come in through
 * the import targets their modules register; nothing here writes another module's tables.
 */
@Module({
  imports: [AccountsModule, CatalogueModule, IamModule, ImportsModule, TerritoriesModule],
  controllers: [ErpController],
  providers: [
    ErpConnectionsService,
    ErpPull,
    ErpUpkeep,
    ZohoBooks,
    ColumnCipher,
    FakeZohoBooks,
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
