import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type EventPayload,
  WEBHOOK_EVENTS,
  webhookData,
  type WebhookEventKey,
} from '@thelamp/shared';
import { and, eq, lt, ne, sql } from 'drizzle-orm';
import { webhookMessages } from '../../db/schema/webhooks';
import { Database } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { DELIVER, WebhooksService } from './webhooks.service';

const DAY_MS = 86_400_000;
/** Messages are kept 35 days, the delivery log three months (decision D94). */
const MESSAGE_KEEP_DAYS = 35;
const LOG_KEEP_MONTHS = 3;

/**
 * What runs webhooks in the background (decision D94): every subscribable event becomes messages;
 * the worker tries each; daily, the delivery log's partitions are made ahead and old ones dropped,
 * and each tenant's settled messages past their keeping time are removed.
 */
@Injectable()
export class WebhooksUpkeep implements OnModuleInit {
  constructor(
    private readonly outbox: Outbox,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    private readonly database: Database,
    private readonly webhooks: WebhooksService,
  ) {}

  onModuleInit(): void {
    this.outbox.consume(WEBHOOK_EVENTS, 'webhooks.fan_out', async (event, tx) => {
      const type = event.type as WebhookEventKey;
      await this.webhooks.fanOut(
        tx,
        event.tenantId,
        { id: event.id, type, createdAt: event.createdAt },
        webhookData(type, event.payload as EventPayload<WebhookEventKey>),
      );
    });
    this.queues.handle('webhooks', DELIVER, (data) =>
      this.webhooks.deliver(String(data.tenantId), String(data.messageId), String(data.run ?? '')),
    );
    this.queues.handle('maintenance', 'webhooks.partitions', async () => {
      await this.database.db.execute(sql`select cell.ensure_webhook_delivery_partitions()`);
      await this.database.db.execute(
        sql`select cell.drop_old_webhook_delivery_partitions(${LOG_KEEP_MONTHS})`,
      );
    });
    this.schedules.every({
      id: 'webhooks.partitions',
      everyMs: DAY_MS,
      queue: 'maintenance',
      kind: 'webhooks.partitions',
    });
    this.queues.handle('maintenance', 'webhooks.retention', (data) =>
      this.trim(String(data.tenantId)),
    );
    this.schedules.everyForTenants({
      name: 'webhooks_retention',
      everyMs: DAY_MS,
      queue: 'maintenance',
      kind: 'webhooks.retention',
    });
  }

  /** Removes a tenant's delivered and given-up messages older than their keeping time. */
  async trim(tenantId: string, now = new Date()): Promise<void> {
    await this.database.forTenant(tenantId, (tx) =>
      tx
        .delete(webhookMessages)
        .where(
          and(
            eq(webhookMessages.tenantId, tenantId),
            ne(webhookMessages.status, 'pending'),
            lt(webhookMessages.createdAt, new Date(now.getTime() - MESSAGE_KEEP_DAYS * DAY_MS)),
          ),
        ),
    );
  }
}
