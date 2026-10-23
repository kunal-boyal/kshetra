import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { SyncPrice, SyncPriceList } from '@thelamp/shared';
import { and, asc, eq, gte, inArray, type SQL, sql } from 'drizzle-orm';
import { priceListItems, priceLists } from '../../db/schema/catalogue';
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
 * Which price lists a phone keeps (spec 5.11, decision D77): every list for everyone, account
 * types, segments or territories, and the lists for single accounts the person sees. Lists enter
 * and leave that set as accounts change hands and lists change targets, so the scope is a hash of
 * the lists themselves: when it changes, the phone takes a fresh copy of lists and prices.
 */
@Injectable()
export class PriceVisibility {
  constructor(private readonly accounts: AccountsService) {}

  async where(tx: TenantTx, access: Access): Promise<SQL> {
    return and(
      eq(priceLists.tenantId, access.tenantId),
      sql`(${priceLists.scope} <> 'account'
        or ${priceLists.targets} && array${await this.accounts.reachIds(tx, access)})`,
    )!;
  }

  async scope(tx: TenantTx, access: Access): Promise<string> {
    const [row] = await tx
      .select({
        hash: sql<string>`md5(coalesce(string_agg(${priceLists.id}::text, ',' order by ${priceLists.id}), ''))`,
      })
      .from(priceLists)
      .where(await this.where(tx, access));
    return row!.hash;
  }
}

@Injectable()
export class PriceListsSync implements SyncSource<SyncPriceList>, OnModuleInit {
  readonly name = 'price_lists';
  readonly version = 1;

  constructor(
    private readonly entities: SyncEntities,
    private readonly visible: PriceVisibility,
  ) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  scope(tx: TenantTx, access: Access): Promise<string> {
    return this.visible.scope(tx, access);
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncPriceList>[]> {
    const rows = await tx
      .select({
        version: priceLists.rowVersion,
        id: priceLists.id,
        name: priceLists.name,
        scope: priceLists.scope,
        targets: priceLists.targets,
        priority: priceLists.priority,
        validFrom: priceLists.validFrom,
        validTo: priceLists.validTo,
        active: priceLists.active,
      })
      .from(priceLists)
      .where(
        and(
          await this.visible.where(tx, access),
          gte(priceLists.rowVersion, page.since),
          page.after
            ? sql`(${priceLists.rowVersion}, ${priceLists.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(priceLists.rowVersion), asc(priceLists.id))
      .limit(page.limit);
    return rows.map(({ version, ...row }) => ({ version, id: row.id, row }));
  }
}

/** The prices on the lists the phone keeps, removed ones included so the phone drops them. */
@Injectable()
export class PricesSync implements SyncSource<SyncPrice>, OnModuleInit {
  readonly name = 'prices';
  readonly version = 1;

  constructor(
    private readonly entities: SyncEntities,
    private readonly visible: PriceVisibility,
  ) {}

  onModuleInit(): void {
    this.entities.register(this);
  }

  scope(tx: TenantTx, access: Access): Promise<string> {
    return this.visible.scope(tx, access);
  }

  async rows(tx: TenantTx, access: Access, page: SyncRowsPage): Promise<SyncRow<SyncPrice>[]> {
    const lists = tx
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(await this.visible.where(tx, access));
    const rows = await tx
      .select({
        version: priceListItems.rowVersion,
        id: priceListItems.id,
        priceListId: priceListItems.priceListId,
        itemId: priceListItems.itemId,
        price: priceListItems.price,
        discount: priceListItems.discount,
        removed: sql<boolean>`${priceListItems.removedAt} is not null`,
      })
      .from(priceListItems)
      .where(
        and(
          eq(priceListItems.tenantId, access.tenantId),
          inArray(priceListItems.priceListId, lists),
          gte(priceListItems.rowVersion, page.since),
          page.after
            ? sql`(${priceListItems.rowVersion}, ${priceListItems.id}) > (${page.after[0]}::bigint, ${page.after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(priceListItems.rowVersion), asc(priceListItems.id))
      .limit(page.limit);
    return rows.map(({ version, ...row }) => ({ version, id: row.id, row }));
  }
}
