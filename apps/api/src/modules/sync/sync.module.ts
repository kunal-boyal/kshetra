import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncEntities } from './sync-entities';
import { SyncService } from './sync.service';
import { SyncTombstones } from './tombstones';

/**
 * The mobile pull protocol and its tombstones (spec 9.6, 11.3). Modules that own syncable
 * tables register their entities with `SyncEntities` and write tombstones with `SyncTombstones`.
 */
@Module({
  controllers: [SyncController],
  providers: [SyncEntities, SyncService, SyncTombstones],
  exports: [SyncEntities, SyncTombstones],
})
export class SyncModule {}
