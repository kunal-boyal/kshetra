import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { EventPayload } from '@thelamp/shared';
import { Outbox } from '../../platform/outbox';
import { StockService } from './stock.service';

/**
 * What moves stock in the background (BR-62, decision D130): every fulfilment of an order
 * publishes its status, fulfilled or partly fulfilled, and the units fulfilled since stock last
 * moved for each line move into the buyer and out of a supplying account that keep stock.
 */
@Injectable()
export class StockUpkeep implements OnModuleInit {
  constructor(
    private readonly outbox: Outbox,
    private readonly stock: StockService,
  ) {}

  onModuleInit(): void {
    this.outbox.consume(['order.status_changed'], 'stock.fulfilment', async (event, tx) => {
      const { orderId, status } = event.payload as EventPayload<'order.status_changed'>;
      if (status !== 'fulfilled' && status !== 'partially_fulfilled') return;
      await this.stock.fromOrder(tx, event.tenantId, orderId);
    });
  }
}
