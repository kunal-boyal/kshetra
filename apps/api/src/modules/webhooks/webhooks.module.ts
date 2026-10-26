import { Module } from '@nestjs/common';
import { ColumnCipher } from '../../platform/column-cipher';
import { WebhookSender } from './webhook-sender';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksUpkeep } from './webhooks.upkeep';

/** Webhooks (module M20, spec 12.4, decision D94): subscriptions, delivery, the log and replay. */
@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhooksUpkeep, WebhookSender, ColumnCipher],
  exports: [WebhooksService],
})
export class WebhooksModule {}
