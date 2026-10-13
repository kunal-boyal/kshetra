import { Module } from '@nestjs/common';
import { ImportsModule } from '../imports/imports.module';
import { SyncModule } from '../sync/sync.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';
import { ItemsImport } from './items.import';
import { ItemsSync } from './items.sync';

/** Catalogue settings, categories, products and items (spec 5.11, 9.6). */
@Module({
  imports: [ImportsModule, TenantConfigModule, SyncModule],
  controllers: [CatalogueController],
  providers: [CatalogueService, ItemsImport, ItemsSync],
  exports: [CatalogueService],
})
export class CatalogueModule {}
