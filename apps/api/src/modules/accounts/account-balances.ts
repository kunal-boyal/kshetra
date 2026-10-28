import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';

/** Each account's latest outstanding balance, as account finance knows it. */
export interface BalanceSource {
  latest(
    tx: TenantTx,
    tenantId: string,
    accountIds: readonly string[],
  ): Promise<Map<string, string>>;
}

/**
 * The outstanding balance the accounts list shows (decision D104). Account finance (M11) provides
 * it, as it depends on accounts; until it does, or while its module is off, no account has one.
 */
@Injectable()
export class AccountBalances {
  private source: BalanceSource | undefined;

  provide(source: BalanceSource): void {
    if (this.source) throw new Error('Account balances are provided already.');
    this.source = source;
  }

  latest(tx: TenantTx, tenantId: string, accountIds: readonly string[]) {
    return this.source?.latest(tx, tenantId, accountIds) ?? Promise.resolve(new Map());
  }
}
