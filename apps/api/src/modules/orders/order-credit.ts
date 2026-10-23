import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';

/** Whether an order takes an account past its credit limit, as account finance knows it. */
export interface CreditSource {
  over(tx: TenantTx, tenantId: string, accountId: string, total: string): Promise<boolean>;
}

/**
 * The `over_credit` fact for the order chain (spec 5.9, decision D73): an order over the credit
 * limit goes to an approval step. Account finance (step 4, M11) provides the limits; until it
 * does, no order is over.
 */
@Injectable()
export class OrderCredit {
  private source: CreditSource | undefined;

  provide(source: CreditSource): void {
    if (this.source) throw new Error('Credit limits are provided already.');
    this.source = source;
  }

  over(tx: TenantTx, tenantId: string, accountId: string, total: string): Promise<boolean> {
    return this.source?.over(tx, tenantId, accountId, total) ?? Promise.resolve(false);
  }
}
