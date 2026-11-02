import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';

/** What a supplying account lacks of an order's items, as distributors' stock knows it. */
export interface StockSource {
  short(
    tx: TenantTx,
    tenantId: string,
    supplierAccountId: string,
    lines: readonly { itemId: string; baseUnits: string }[],
  ): Promise<{ itemId: string; short: string }[]>;
}

/**
 * The `short_stock` fact for the order chain and each line's shortfall (BR-62, decision D130): a
 * secondary order asking for more than its supplier holds is flagged, never refused. The inventory
 * module provides the stock; until it does, nothing is short.
 */
@Injectable()
export class OrderStock {
  private source: StockSource | undefined;

  provide(source: StockSource): void {
    if (this.source) throw new Error('Stock is provided already.');
    this.source = source;
  }

  short(
    tx: TenantTx,
    tenantId: string,
    supplierAccountId: string,
    lines: readonly { itemId: string; baseUnits: string }[],
  ): Promise<{ itemId: string; short: string }[]> {
    return this.source?.short(tx, tenantId, supplierAccountId, lines) ?? Promise.resolve([]);
  }
}
