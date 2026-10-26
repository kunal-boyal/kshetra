import { Module } from '@nestjs/common';
import { ArchiveSigner } from '../../platform/archive-signer';
import { IamModule } from '../iam/iam.module';
import { MediaModule } from '../media/media.module';
import { MediaUrls } from '../media/media-urls';
import { DataExportsController } from './data-exports.controller';
import { DataExportsService } from './data-exports.service';
import { TenantArchive } from './tenant-archive';
import { TenantMoves } from './tenant-moves';

/** Data governance (module M21, decision D95): the tenant's signed data export, and moving it. */
@Module({
  imports: [IamModule, MediaModule],
  controllers: [DataExportsController],
  providers: [DataExportsService, TenantArchive, TenantMoves, ArchiveSigner, MediaUrls],
  exports: [TenantArchive, TenantMoves, ArchiveSigner],
})
export class GovernanceModule {}
