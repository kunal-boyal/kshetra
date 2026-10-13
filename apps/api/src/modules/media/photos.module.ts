import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { MediaUrls } from './media-urls';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

/**
 * Photos: registering, uploading, processing and reading them (spec 12.2). Apart from the media
 * module, which imports and exports use and which IAM reaches through imports, so neither
 * depends on the other in a circle.
 */
@Module({
  imports: [IamModule, TenantConfigModule],
  controllers: [PhotosController],
  providers: [PhotosService, MediaUrls],
  exports: [PhotosService],
})
export class PhotosModule {}
