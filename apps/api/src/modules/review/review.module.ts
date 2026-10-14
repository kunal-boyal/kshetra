import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { IamModule } from '../iam/iam.module';
import { PhotosModule } from '../media/photos.module';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

/** Evidence review: the queue, decisions and auto-approval (M7, spec 9.6 `review`). */
@Module({
  imports: [FieldModule, IamModule, PhotosModule],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}
