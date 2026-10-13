import { Module } from '@nestjs/common';
import { ImportsModule } from '../imports/imports.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';
import { ItemsImport } from './items.import';

/** Catalogue settings, categories, products and items (spec 5.11, 9.6). */
@Module({
  imports: [ImportsModule, TenantConfigModule],
  controllers: [CatalogueController],
  providers: [CatalogueService, ItemsImport],
  exports: [CatalogueService],
})
export class CatalogueModule {}
