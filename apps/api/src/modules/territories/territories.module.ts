import { Module } from '@nestjs/common';
import { ImportsModule } from '../imports/imports.module';
import { SyncModule } from '../sync/sync.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TerritoriesController } from './territories.controller';
import { TerritoriesImport } from './territories.import';
import { TerritoriesService } from './territories.service';
import { TerritoriesSync } from './territories.sync';

/** Geography levels, territory nodes and user attachments (spec 5.4, 9.6). */
@Module({
  imports: [SyncModule, TenantConfigModule, ImportsModule],
  controllers: [TerritoriesController],
  providers: [TerritoriesService, TerritoriesSync, TerritoriesImport],
  exports: [TerritoriesService],
})
export class TerritoriesModule {}
