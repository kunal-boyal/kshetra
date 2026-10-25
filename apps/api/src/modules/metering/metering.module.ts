import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { MeteringService } from './metering.service';

/** Metered usage in the cell (M22, decision D89), sent to the directory's billing. */
@Module({
  imports: [IamModule, MediaModule, NotificationsModule, TenantConfigModule],
  providers: [MeteringService],
  exports: [MeteringService],
})
export class MeteringModule {}
