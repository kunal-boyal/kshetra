import { Module } from '@nestjs/common';
import { ArchiveSigner } from '../../platform/archive-signer';
import { FieldModule } from '../field/field.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { MediaModule } from '../media/media.module';
import { MediaUrls } from '../media/media-urls';
import { CellTenantArchives } from './cell-tenant-archives';
import { DataExportsController } from './data-exports.controller';
import { DataRequestsController } from './data-requests.controller';
import { DataRequestsService } from './data-requests.service';
import { DataExportsService } from './data-exports.service';
import { RecordRetention } from './record-retention';
import { TenantArchive } from './tenant-archive';
import { TenantMoves } from './tenant-moves';

/**
 * Data governance (module M21, decision D95): the tenant's signed data export, moving it between
 * cells, and retention for the records the tenant chooses how long to keep.
 */
@Module({
  imports: [
    IamModule,
    MediaModule,
    ImportsModule,
    NotificationsModule,
    TenantConfigModule,
    FieldModule,
  ],
  controllers: [DataExportsController, DataRequestsController],
  providers: [
    DataExportsService,
    TenantArchive,
    TenantMoves,
    CellTenantArchives,
    RecordRetention,
    DataRequestsService,
    ArchiveSigner,
    MediaUrls,
  ],
  exports: [TenantArchive, TenantMoves, CellTenantArchives, ArchiveSigner],
})
export class GovernanceModule {}
