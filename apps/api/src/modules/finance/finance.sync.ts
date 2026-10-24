import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { SyncBalance } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import { financeSnapshots } from '../../db/schema/finance';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import {
  type SyncRow,
  type SyncRowsPage,
  type SyncSource,
  SyncEntities,
} from '../sync/sync-entities';

/**
 * What a phone keeps of account finance (M11, decision D79): the latest balance of each account
 * its person sees, keyed by the account, so a newer balance replaces the one before. Only for
 * people who may see finance; the scope follows the accounts they see.
 */
@Injectable()
export class BalancesSync implements SyncSource<SyncBalance>, OnModuleInit {
  readonly name = 'balances';
  readonly version = 1;

  constructor(
    private readonly entities: SyncEntities,
    private readonly accounts: AccountsService,
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
    const result = await tx.execute<{
      row_version: string;
      account_id: string;
      as_of: string;
      outstanding: string;
      credit_limit: string | null;
      ageing: Record<string, string>;
    }>(sql`
      with latest as (
        select distinct on (${financeSnapshots.accountId})
               ${financeSnapshots.accountId} as account_id, ${financeSnapshots.asOf} as as_of,
               ${financeSnapshots.outstanding} as outstanding,
               ${financeSnapshots.creditLimit} as credit_limit,
               ${financeSnapshots.ageing} as ageing, ${financeSnapshots.rowVersion} as row_version
          from ${financeSnapshots}
         where ${financeSnapshots.tenantId} = ${access.tenantId}
           and ${financeSnapshots.accountId}::text in ${reach}
         order by ${financeSnapshots.accountId}, ${financeSnapshots.asOf} desc,
                  ${financeSnapshots.createdAt} desc
      )
      select * from latest
       where row_version >= ${page.since}
         ${page.after ? sql`and (row_version, account_id) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)` : sql``}
       order by row_version, account_id
       limit ${page.limit}`);
    return result.rows.map((row) => ({
      version: Number(row.row_version),
      id: row.account_id,
      row: {
        id: row.account_id,
        accountId: row.account_id,
        asOf: String(row.as_of).slice(0, 10),
        outstanding: row.outstanding,
        creditLimit: row.credit_limit,
        ageing: row.ageing,
      },
    }));
  }
}
