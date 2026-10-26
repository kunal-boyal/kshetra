import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { orders } from '../../db/schema/orders';
import { VisitOrders } from '../field/visit-orders';

/**
 * Tells visit forms whether their visit took an order (decision D97): any order placed in it,
 * whatever became of it later, as the person filling the form saw it.
 */
@Injectable()
export class VisitOrdersProvider implements OnModuleInit {
  constructor(private readonly visitOrders: VisitOrders) {}

  onModuleInit(): void {
    this.visitOrders.provide({
      taken: async (tx, tenantId, visitId) => {
        const [found] = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.tenantId, tenantId), eq(orders.visitId, visitId)))
          .limit(1);
        return found !== undefined;
      },
    });
  }
}
