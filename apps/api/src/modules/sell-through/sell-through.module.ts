import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { SellThroughController } from './sell-through.controller';
import { SellThroughImport } from './sell-through.import';
import { SellThroughService } from './sell-through.service';

/**
 * Sell-through by item (BR-53, decision D124): accounts' monthly stock statements, from the
 * phone, the import and the bulk API. Templates give it its word, such as liquidation.
 */
@Module({
  imports: [AccountsModule, CatalogueModule, IamModule, ImportsModule, TenantConfigModule],
  controllers: [SellThroughController],
  providers: [SellThroughService, SellThroughImport],
  exports: [SellThroughService],
})
export class SellThroughModule {}
