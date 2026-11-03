import { Injectable, type OnModuleInit } from '@nestjs/common';
import { formatMoney } from '@thelamp/i18n';
import type { EventPayload } from '@thelamp/shared';
import { Outbox } from '../../platform/outbox';
import { NotificationsService } from '../notifications/notifications.service';
import { CollectionsService } from './collections.service';

/**
 * Tells collectors when the office turns a collection down or its cheque bounces (BR-63,
 * decision D132), once each, however often the event comes.
 */
@Injectable()
export class CollectionsUpkeep implements OnModuleInit {
  constructor(
    private readonly outbox: Outbox,
    private readonly collections: CollectionsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.outbox.consume(['collection.status_changed'], 'collections.notices', async (event, tx) => {
      const payload = event.payload as EventPayload<'collection.status_changed'>;
      if (payload.status !== 'rejected' && payload.status !== 'bounced') return;
      const notice = await this.collections.notice(tx, event.tenantId, payload.collectionId);
      if (!notice) return;
      const amount = notice.amount as `${number}`;
      await this.notifications.notify(tx, event.tenantId, {
        userId: payload.userId,
        event: payload.status === 'rejected' ? 'collection.rejected' : 'collection.bounced',
        values: {
          name: notice.decidedBy ?? '',
          number: notice.number,
          account: notice.account,
          reason: notice.reason,
          amount_en: formatMoney(amount, { locale: 'en' }),
          amount_hi: formatMoney(amount, { locale: 'hi' }),
        },
        link: null,
        dedupeKey: `collection:${payload.collectionId}:${payload.status}`,
      });
    });
  }
}
