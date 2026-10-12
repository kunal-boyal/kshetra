import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { TerritoriesController } from './territories.controller';
import { TerritoriesService } from './territories.service';
import { TerritoriesSync } from './territories.sync';

/** Geography levels, territory nodes and user attachments (spec 5.4, 9.6). */
@Module({
  imports: [SyncModule],
  controllers: [TerritoriesController],
  providers: [TerritoriesService, TerritoriesSync],
  exports: [TerritoriesService],
})
export class TerritoriesModule {}
