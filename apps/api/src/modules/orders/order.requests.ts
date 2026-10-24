import { Injectable, type OnModuleInit } from '@nestjs/common';
import { RequestTypes } from '../workflow/request-types';
import { OrdersService } from './orders.service';

/**
 * Orders go through the `order` chain (spec 5.9, decision D78), decided on the order's own page:
 * rejecting takes a configured reason, and some steps decide line by line. A withdrawn order is
 * cancelled.
 */
@Injectable()
export class OrderRequests implements OnModuleInit {
  constructor(
    private readonly types: RequestTypes,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit(): void {
    this.types.register({
      type: 'order',
      fallbackPermission: 'order.decide',
      module: 'orders',
      ownPage: (orderId) => `/orders/${orderId}`,
      subjects: (tx, tenantId, ids) => this.orders.subjects(tx, tenantId, ids),
      decided: (tx, by, id, outcome) => this.orders.decided(tx, by.tenantId, id, outcome),
    });
  }
}
