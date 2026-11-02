import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type SyncStock, stockUnits, stockUnitsText } from '@thelamp/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { stockLevels } from '../../db/schema/stock';
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
 * What a phone keeps of distributors' stock (BR-62, decision D130): each account it sees that
 * holds stock, as one row of its items keyed by the account, moving whenever any item's level
 * moves; so the account screen and a cart through it show stock offline. Nothing while inventory
 * is off (D82), and only for people who see stock.
 */
@Injectable()
export class StockSync implements SyncSource<SyncStock>, OnModuleInit {
  readonly name = 'stock';
  readonly version = 1;

  constructor(
    private readonly entities: SyncEntities,
    private readonly accounts: AccountsService,
  ) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  private open(access: Access): boolean {
    return !access.modulesOff.includes('inventory') && access.permissions.has('stock.view');
  }

  async scope(tx: TenantTx, access: Access): Promise<string> {
    if (access.modulesOff.includes('inventory')) return 'off';
    if (!access.permissions.has('stock.view')) return 'none';
    return this.accounts.reachHash(tx, access);
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncStock>[]> {
    if (!this.open(access)) return [];
    const reach = await this.accounts.reachIds(tx, access);
    const latest = sql<string>`max(${stockLevels.rowVersion})`;
    const changed = await tx
      .select({ accountId: stockLevels.accountId, version: latest })
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.tenantId, access.tenantId),
          sql`${stockLevels.accountId}::text in (${reach})`,
        ),
      )
      .groupBy(stockLevels.accountId)
      .having(
        and(
          sql`${latest} >= ${page.since}`,
          page.after
            ? sql`(${latest}, ${stockLevels.accountId}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : sql`true`,
        ),
      )
      .orderBy(latest, stockLevels.accountId)
      .limit(page.limit);
    if (changed.length === 0) return [];
    const levels = await tx
      .select()
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.tenantId, access.tenantId),
          inArray(
            stockLevels.accountId,
            changed.map((row) => row.accountId),
          ),
        ),
      );
    return changed.map((row) => ({
      version: Number(row.version),
      id: row.accountId,
      row: {
        id: row.accountId,
        accountId: row.accountId,
        items: levels
          .filter((level) => level.accountId === row.accountId)
          .map((level) => ({
            itemId: level.itemId,
            onHand: stockUnitsText(stockUnits(level.onHand)),
            countedOn: level.countedOn,
          })),
      },
    }));
  }
}
