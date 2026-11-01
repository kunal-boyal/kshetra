import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { SyncBalance } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import { accountInvoices, accountReceipts, financeSnapshots } from '../../db/schema/finance';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { FinanceService } from './finance.service';
import { ReceivablesService } from './receivables.service';
import {
  type SyncRow,
  type SyncRowsPage,
  type SyncSource,
  SyncEntities,
} from '../sync/sync-entities';

/**
 * What a phone keeps of account finance (M11, decision D79): the balance of each account its
 * person sees, keyed by the account, so a newer balance replaces the one before: what its
 * invoices leave open once it has any (D121), else its latest snapshot. Only for people who may
 * see finance; the scope follows the accounts they see.
 */
@Injectable()
export class BalancesSync implements SyncSource<SyncBalance>, OnModuleInit {
  readonly name = 'balances';
  readonly version = 2;

  constructor(
    private readonly entities: SyncEntities,
    private readonly accounts: AccountsService,
    private readonly finance: FinanceService,
    private readonly receivables: ReceivablesService,
  ) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  async scope(tx: TenantTx, access: Access): Promise<string> {
    if (!access.permissions.has('finance.view')) return 'none';
    return this.accounts.reachHash(tx, access);
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncBalance>[]> {
    if (!access.permissions.has('finance.view')) return [];
    const reach = await this.accounts.reachIds(tx, access);
    // An account's balance moves when any of its snapshots, invoices or receipts is written, so
    // its row version is the latest of theirs; accounts with only receipts have no balance yet.
    const result = await tx.execute<{ account_id: string; row_version: string }>(sql`
      with versions as (
        select ${financeSnapshots.accountId} as account_id,
               max(${financeSnapshots.rowVersion}) as row_version, true as balanced
          from ${financeSnapshots} where ${financeSnapshots.tenantId} = ${access.tenantId}
         group by 1
        union all
        select ${accountInvoices.accountId}, max(${accountInvoices.rowVersion}), true
          from ${accountInvoices} where ${accountInvoices.tenantId} = ${access.tenantId}
         group by 1
        union all
        select ${accountReceipts.accountId}, max(${accountReceipts.rowVersion}), false
          from ${accountReceipts} where ${accountReceipts.tenantId} = ${access.tenantId}
         group by 1
      ), balances as (
        select account_id, max(row_version) as row_version
          from versions
         where account_id::text in ${reach}
         group by account_id
        having bool_or(balanced)
      )
      select account_id, row_version from balances
       where row_version >= ${page.since}
         ${page.after ? sql`and (row_version, account_id) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)` : sql``}
       order by row_version, account_id
       limit ${page.limit}`);
    const ids = result.rows.map((row) => row.account_id);
    const latest = await this.finance.latestOf(tx, access.tenantId, ids);
    const figures = await this.receivables.receivables(tx, access.tenantId, ids);
    return result.rows.map((row) => {
      const snapshot = latest.get(row.account_id) ?? null;
      const owed = figures.get(row.account_id);
      return {
        version: Number(row.row_version),
        id: row.account_id,
        // Once the account has invoices, they say what it owes (D121).
        row: owed
          ? {
              id: row.account_id,
              accountId: row.account_id,
              asOf: owed.asOf,
              outstanding: owed.outstanding,
              creditLimit: snapshot?.creditLimit ?? null,
              ageing: owed.ageing,
            }
          : {
              id: row.account_id,
              accountId: row.account_id,
              asOf: snapshot!.asOf,
              outstanding: snapshot!.outstanding,
              creditLimit: snapshot!.creditLimit,
              ageing: snapshot!.ageing,
            },
      };
    });
  }
}
