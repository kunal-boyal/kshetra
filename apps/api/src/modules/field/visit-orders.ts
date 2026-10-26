import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';

/** Whether a visit took an order, as the orders module knows it. */
export interface VisitOrderSource {
  taken(tx: TenantTx, tenantId: string, visitId: string): Promise<boolean>;
}

/**
 * The `visit_ordered` fact a visit form's conditions may ask (decision D97), such as a no-order
 * reason shown only when none was taken. The orders module provides it; without it, no visit
 * took an order.
 */
@Injectable()
export class VisitOrders {
  private source: VisitOrderSource | undefined;

  provide(source: VisitOrderSource): void {
    if (this.source) throw new Error('Visit orders are provided already.');
    this.source = source;
  }

  taken(tx: TenantTx, tenantId: string, visitId: string): Promise<boolean> {
    return this.source?.taken(tx, tenantId, visitId) ?? Promise.resolve(false);
  }
}
