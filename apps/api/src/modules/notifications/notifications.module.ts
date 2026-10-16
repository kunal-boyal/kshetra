import { Module } from '@nestjs/common';
import type { Config } from '../../config';
import { CONFIG } from '../../platform/tokens';
import { FieldModule } from '../field/field.module';
import { FormsModule } from '../forms/forms.module';
import { IamModule } from '../iam/iam.module';
import { PlanningModule } from '../planning/planning.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { NotificationDelivery } from './delivery';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsUpkeep } from './notifications.upkeep';
import { EmailSender, emailSender, PushSender, pushSender, SmsSender, smsSender } from './senders';

/** Notifications (M16, spec 9.6 `notifications`, decision D58). */
@Module({
  imports: [IamModule, FieldModule, PlanningModule, FormsModule, TenantConfigModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationDelivery,
    NotificationsUpkeep,
    { provide: PushSender, inject: [CONFIG], useFactory: (c: Config) => pushSender(c) },
    { provide: SmsSender, inject: [CONFIG], useFactory: (c: Config) => smsSender(c) },
    { provide: EmailSender, inject: [CONFIG], useFactory: (c: Config) => emailSender(c) },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
