import { Module } from '@nestjs/common';
import { ArchiveSigner } from '../../platform/archive-signer';
import { IamModule } from '../iam/iam.module';
import { MediaModule } from '../media/media.module';
import { MediaUrls } from '../media/media-urls';
import { DataExportsController } from './data-exports.controller';
import { DataExportsService } from './data-exports.service';
import { TenantArchive } from './tenant-archive';

/** Data governance (module M21, decision D95): the tenant's signed data export. */
@Module({
  imports: [IamModule, MediaModule],
  controllers: [DataExportsController],
  providers: [DataExportsService, TenantArchive, ArchiveSigner, MediaUrls],
  exports: [TenantArchive, ArchiveSigner],
})
export class GovernanceModule {}
