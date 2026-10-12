import { Module } from '@nestjs/common';
import { MediaService } from './media.service';

/** Files in the object store (spec 9.6, 12.2). Photo uploads and processing arrive in step 6. */
@Module({ providers: [MediaService], exports: [MediaService] })
export class MediaModule {}
