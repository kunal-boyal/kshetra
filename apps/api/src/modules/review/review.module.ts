import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { FieldModule } from '../field/field.module';
import { IamModule } from '../iam/iam.module';
import { PhotosModule } from '../media/photos.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

/** Evidence review: the queue, decisions and auto-approval (M7, spec 9.6 `review`). */
@Module({
  imports: [AccountsModule, FieldModule, IamModule, PhotosModule, TenantConfigModule],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}
