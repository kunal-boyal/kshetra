import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  previousPeriod,
  type SyncStock,
  stockUnits,
  stockUnitsText,
  todayIn,
} from '@thelamp/shared';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { stockLevels, stockMovements } from '../../db/schema/stock';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import {
  type SyncRow,
  type SyncRowsPage,
  type SyncSource,
  SyncEntities,
} from '../sync/sync-entities';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/**
 * What a phone keeps of distributors' stock (BR-62, decision D130): each account it sees that
 * holds stock, as one row of its items keyed by the account, moving whenever any item's level
 * moves; so the account screen and a cart through it show stock offline. Each item also carries
 * what came in and went back this month and last, from which the phone pre-fills a sell-through
 * statement; the scope follows the month, so a new month sends every row again. Nothing while
 * inventory is off (D82), and only for people who see stock.
 */
@Injectable()
export class StockSync implements SyncSource<SyncStock>, OnModuleInit {
  readonly name = 'stock';
  readonly version = 2;

  constructor(
    private readonly entities: SyncEntities,
    private readonly accounts: AccountsService,
    private readonly config: TenantConfigService,
  ) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  private async month(tx: TenantTx, tenantId: string): Promise<string> {
    return todayIn((await this.config.settings(tx, tenantId)).timezone).slice(0, 7);
  }

  private open(access: Access): boolean {
    return !access.modulesOff.includes('inventory') && access.permissions.has('stock.view');
  }

  async scope(tx: TenantTx, access: Access): Promise<string> {
    if (access.modulesOff.includes('inventory')) return 'off';
    if (!access.permissions.has('stock.view')) return 'none';
    return `${await this.accounts.reachHash(tx, access)}:${await this.month(tx, access.tenantId)}`;
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
    const since = `${previousPeriod(await this.month(tx, access.tenantId))}-01`;
    const period = sql<string>`to_char(${stockMovements.occurredOn}, 'YYYY-MM')`;
    const moves = await tx
      .select({
        accountId: stockMovements.accountId,
        itemId: stockMovements.itemId,
        period,
        received: sql<string>`coalesce(sum(${stockMovements.units}) filter (where ${stockMovements.kind} = 'received'), 0)`,
        returned: sql<string>`coalesce(-sum(${stockMovements.units}) filter (where ${stockMovements.kind} = 'returned_out'), 0)`,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.tenantId, access.tenantId),
          inArray(
            stockMovements.accountId,
            changed.map((row) => row.accountId),
          ),
          inArray(stockMovements.kind, ['received', 'returned_out']),
          gte(stockMovements.occurredOn, since),
        ),
      )
      .groupBy(stockMovements.accountId, stockMovements.itemId, period);
    const movedOf = (accountId: string, itemId: string) =>
      moves
        .filter((move) => move.accountId === accountId && move.itemId === itemId)
        .map((move) => ({
          period: move.period,
          received: stockUnitsText(stockUnits(String(move.received))),
          returned: stockUnitsText(stockUnits(String(move.returned))),
        }));
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
            moved: movedOf(row.accountId, level.itemId),
          })),
      },
    }));
  }
}
