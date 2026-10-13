import { Module } from '@nestjs/common';
import { MediaService } from './media.service';

/** Files in the object store (spec 9.6, 12.2), for imports and exports; photos are PhotosModule. */
@Module({ providers: [MediaService], exports: [MediaService] })
export class MediaModule {}
