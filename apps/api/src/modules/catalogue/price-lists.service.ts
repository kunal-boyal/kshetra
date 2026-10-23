import { Injectable } from '@nestjs/common';
import {
  type AccountPricesResult,
  AppError,
  applicableLists,
  type ErrorDetail,
  netRate,
  type PriceEntry,
  type PriceListBody,
  type PriceListItemsBody,
  type PriceListItemsQuery,
  type PriceListItemsResult,
  type PriceListRef,
  type PriceListResult,
  priceFor,
  todayIn,
} from '@thelamp/shared';
import { and, asc, count, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { items, priceListItems, priceLists } from '../../db/schema/catalogue';
import { type AuditActor, AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountTypesService } from '../accounts/account-types.service';
import { AccountsService } from '../accounts/accounts.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TerritoriesService } from '../territories/territories.service';
import { CatalogueService } from './catalogue.service';

const invalid = (issues: ErrorDetail[]) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', issues);

const notFound = () => new AppError('NOT_FOUND', 'There is no price list with this ID.');

const iso = (moment: Date) => moment.toISOString();

/** Says what is missing without repeating it, so another tenant's ID reads as no ID at all. */
const TARGET_MISSING: Record<Exclude<PriceListBody['scope'], 'default'>, string> = {
  account_type: 'There is no account type with this key',
  segment: 'No account type has a segment with this key',
  territory: 'There is no territory with this ID',
  account: 'There is no account with this ID',
};

const LIST = {
  id: priceLists.id,
  name: priceLists.name,
  scope: priceLists.scope,
  targets: priceLists.targets,
  priority: priceLists.priority,
  validFrom: priceLists.validFrom,
  validTo: priceLists.validTo,
  active: priceLists.active,
  version: priceLists.version,
  updatedAt: priceLists.updatedAt,
};

function selectLists(tx: TenantTx) {
  return tx.select(LIST).from(priceLists);
}

type ListRow = Awaited<ReturnType<typeof selectLists>>[number];

/**
 * Price lists (spec 5.11, decision D77): a default list and lists for account types, segments,
 * territories or single accounts, each with a priority and the dates it applies on; entries hold
 * a price per base unit and a discount. Which list prices an item at an account is
 * `applicableLists()` and `priceFor()` in `@thelamp/shared`, as the phones work it out too.
 * Every change moves the list's version and the catalogue's.
 */
@Injectable()
export class PriceListsService {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly accounts: AccountsService,
    private readonly types: AccountTypesService,
    private readonly territories: TerritoriesService,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {}

  async list(tx: TenantTx, tenantId: string): Promise<PriceListResult[]> {
    const rows = await selectLists(tx)
      .where(eq(priceLists.tenantId, tenantId))
      .orderBy(asc(priceLists.scope), asc(priceLists.name));
    const counts = await this.counts(
      tx,
      tenantId,
      rows.map((row) => row.id),
    );
    return rows.map((row) => this.result(row, counts.get(row.id) ?? 0));
  }

  async get(tx: TenantTx, tenantId: string, id: string): Promise<PriceListResult> {
    const [row] = await selectLists(tx).where(
      and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, id)),
    );
    if (!row) throw notFound();
    return this.result(row, (await this.counts(tx, tenantId, [id])).get(id) ?? 0);
  }

  /** Every list as `applicableLists()` takes them, active or not. */
  async refs(tx: TenantTx, tenantId: string): Promise<(PriceListRef & { name: string })[]> {
    return tx
      .select({
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
      .where(eq(priceLists.tenantId, tenantId));
  }

  /**
   * `PUT /v1/price-lists/{id}`: adds the list with the caller's ID, or changes it at the version
   * the editor saw. Its targets must exist: account types and segments by key, territories and
   * accounts by ID.
   */
  async put(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    id: string,
    body: PriceListBody,
  ): Promise<{ list: PriceListResult; created: boolean }> {
    const by = actor.kind === 'user' ? actor.id : null;
    const [current] = await tx
      .select({ version: priceLists.version })
      .from(priceLists)
      .where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, id)))
      .for('update');
    if (current && body.version === undefined) {
      throw invalid([{ path: 'version', issue: 'Send the version you are changing' }]);
    }
    if (current && body.version !== current.version) {
      throw new AppError('CONFLICT', 'This price list changed meanwhile. Read it again.');
    }
    const targets = [...new Set(body.targets)];
    await this.checkTargets(tx, tenantId, body.scope, targets);
    if (body.validTo && body.validTo < body.validFrom) {
      throw invalid([{ path: 'validTo', issue: 'End on or after the first day' }]);
    }
    const [taken] = await tx
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(
        and(
          eq(priceLists.tenantId, tenantId),
          sql`lower(${priceLists.name}) = ${body.name.trim().toLowerCase()}`,
          sql`${priceLists.id} <> ${id}`,
        ),
      );
    if (taken) {
      throw new AppError('CONFLICT', 'Another price list has this name.', [
        { path: 'name', issue: 'Another price list has this name' },
      ]);
    }
    const before = current ? await this.get(tx, tenantId, id) : null;
    const columns = {
      name: body.name,
      scope: body.scope,
      targets,
      priority: body.priority,
      validFrom: body.validFrom,
      validTo: body.validTo,
      active: body.active,
    };
    if (current) {
      await tx
        .update(priceLists)
        .set({
          ...columns,
          version: current.version + 1,
          updatedAt: new Date(),
          updatedBy: by,
        })
        .where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, id)));
    } else {
      await tx
        .insert(priceLists)
        .values({ id, tenantId, ...columns, createdBy: by, updatedBy: by });
    }
    await this.catalogue.touch(tx, tenantId);
    const list = await this.get(tx, tenantId, id);
    await this.audit.record(tx, tenantId, actor, {
      action: current ? 'price_list.updated' : 'price_list.created',
      target: { type: 'price_list', id },
      ...(before ? { before } : {}),
      after: list,
    });
    return { list, created: !current };
  }

  private async checkTargets(
    tx: TenantTx,
    tenantId: string,
    scope: PriceListBody['scope'],
    targets: string[],
  ): Promise<void> {
    if (scope === 'default') {
      if (targets.length > 0) {
        throw invalid([{ path: 'targets', issue: 'A default list is for everyone' }]);
      }
      return;
    }
    if (targets.length === 0) {
      throw invalid([{ path: 'targets', issue: 'Choose at least one' }]);
    }
    let known = new Set<string>();
    if (scope === 'account_type' || scope === 'segment') {
      const types = await this.types.list(tx, tenantId);
      known = new Set(
        scope === 'account_type'
          ? types.map((type) => type.key)
          : types.flatMap((type) => type.definition.segmentRules.map((rule) => rule.segment)),
      );
    } else {
      const uuids = targets.filter((target) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target),
      );
      known =
        scope === 'territory'
          ? new Set((await this.territories.byIds(tx, tenantId, uuids)).keys())
          : await this.accounts.existing(tx, tenantId, uuids);
    }
    const issues = targets.flatMap((target, index) =>
      known.has(target)
        ? []
        : [
            {
              path: `targets.${index}`,
              issue: TARGET_MISSING[scope],
            },
          ],
    );
    if (issues.length > 0) throw invalid(issues);
  }

  /** `GET /v1/price-lists/{id}/items`: the list's prices by item code, a page at a time. */
  async items(
    tx: TenantTx,
    tenantId: string,
    id: string,
    query: PriceListItemsQuery,
  ): Promise<PriceListItemsResult> {
    await this.get(tx, tenantId, id);
    const pattern = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const rows = await tx
      .select({
        id: items.id,
        code: items.code,
        name: items.name,
        packLabel: items.packLabel,
        baseUnit: items.baseUnit,
        taxRate: items.taxRate,
        price: priceListItems.price,
        discount: priceListItems.discount,
      })
      .from(priceListItems)
      .innerJoin(
        items,
        and(eq(items.tenantId, priceListItems.tenantId), eq(items.id, priceListItems.itemId)),
      )
      .where(
        and(
          eq(priceListItems.tenantId, tenantId),
          eq(priceListItems.priceListId, id),
          isNull(priceListItems.removedAt),
          pattern
            ? or(sql`${items.code} ilike ${pattern}`, sql`${items.name} ilike ${pattern}`)
            : undefined,
          query.cursor ? gt(sql`lower(${items.code})`, query.cursor.toLowerCase()) : undefined,
        ),
      )
      .orderBy(sql`lower(${items.code})`)
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(({ price, discount, ...item }) => ({
        item,
        price,
        discount,
        rate: netRate(price, discount),
      })),
      nextCursor: rows.length > query.limit ? page.at(-1)!.code.toLowerCase() : null,
    };
  }

  /**
   * `PUT /v1/price-lists/{id}/items`: sets prices and removes items, at the version the editor
   * saw. A removed entry keeps its row, marked removed, so phones learn of it.
   */
  async setItems(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    id: string,
    body: PriceListItemsBody,
  ): Promise<PriceListResult> {
    const by = actor.kind === 'user' ? actor.id : null;
    const [current] = await tx
      .select({ version: priceLists.version })
      .from(priceLists)
      .where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, id)))
      .for('update');
    if (!current) throw notFound();
    if (body.version !== current.version) {
      throw new AppError('CONFLICT', 'This price list changed meanwhile. Read it again.');
    }
    const issues: ErrorDetail[] = [];
    const ids = [...body.set.map((entry) => entry.itemId), ...body.remove];
    const found = new Set(
      ids.length === 0
        ? []
        : (
            await tx
              .select({ id: items.id })
              .from(items)
              .where(and(eq(items.tenantId, tenantId), inArray(items.id, ids)))
          ).map((row) => row.id),
    );
    const setIds = new Set<string>();
    body.set.forEach((entry, index) => {
      if (!found.has(entry.itemId)) {
        issues.push({ path: `set.${index}.itemId`, issue: 'There is no item with this ID' });
      } else if (setIds.has(entry.itemId)) {
        issues.push({ path: `set.${index}.itemId`, issue: 'Each item appears once' });
      }
      setIds.add(entry.itemId);
    });
    body.remove.forEach((itemId, index) => {
      if (setIds.has(itemId)) {
        issues.push({ path: `remove.${index}`, issue: 'This item is also being set' });
      }
    });
    if (issues.length > 0) throw invalid(issues);

    const now = new Date();
    await this.upsert(tx, tenantId, by, id, body.set, now);
    const removed =
      body.remove.length === 0
        ? []
        : await tx
            .update(priceListItems)
            .set({ removedAt: now, updatedAt: now, updatedBy: by })
            .where(
              and(
                eq(priceListItems.tenantId, tenantId),
                eq(priceListItems.priceListId, id),
                inArray(priceListItems.itemId, body.remove),
                isNull(priceListItems.removedAt),
              ),
            )
            .returning({ itemId: priceListItems.itemId });
    await tx
      .update(priceLists)
      .set({ version: current.version + 1, updatedAt: now, updatedBy: by })
      .where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, id)));
    await this.catalogue.touch(tx, tenantId);
    await this.audit.record(tx, tenantId, actor, {
      action: 'price_list.prices_changed',
      target: { type: 'price_list', id },
      after: {
        set: body.set,
        removed: removed.map((row) => row.itemId),
      },
    });
    return this.get(tx, tenantId, id);
  }

  /**
   * Prices from an item import (Appendix B.3), in the import's transaction: set on the list
   * without a version, as the import checked every row first.
   */
  async importPrices(
    tx: TenantTx,
    tenantId: string,
    access: Access,
    id: string,
    entries: readonly { itemId: string; price: string; discount: string }[],
  ): Promise<void> {
    const now = new Date();
    await this.upsert(tx, tenantId, access.userId, id, entries, now);
    await tx
      .update(priceLists)
      .set({ version: sql`${priceLists.version} + 1`, updatedAt: now, updatedBy: access.userId })
      .where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.id, id)));
    await this.catalogue.touch(tx, tenantId);
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'price_list.prices_changed',
      target: { type: 'price_list', id },
      after: { set: entries, removed: [] },
    });
  }

  private async upsert(
    tx: TenantTx,
    tenantId: string,
    by: string | null,
    id: string,
    entries: readonly { itemId: string; price: string; discount: string }[],
    now: Date,
  ): Promise<void> {
    if (entries.length === 0) return;
    await tx
      .insert(priceListItems)
      .values(
        entries.map((entry) => ({
          tenantId,
          priceListId: id,
          itemId: entry.itemId,
          price: entry.price,
          discount: entry.discount,
          createdBy: by,
          updatedBy: by,
        })),
      )
      .onConflictDoUpdate({
        target: [priceListItems.tenantId, priceListItems.priceListId, priceListItems.itemId],
        set: {
          price: sql`excluded.price`,
          discount: sql`excluded.discount`,
          removedAt: null,
          updatedAt: now,
          updatedBy: by,
        },
      });
  }

  /**
   * What each active item costs at an account the caller sees, on a date (spec 5.11): the lists
   * that apply, the most specific first, and each item's price from the first that has it.
   */
  async forAccount(
    tx: TenantTx,
    access: Access,
    accountId: string,
    date?: string,
  ): Promise<AccountPricesResult> {
    const tenantId = access.tenantId;
    const account = await this.accounts.find(tx, access, accountId);
    const day = date ?? todayIn((await this.config.settings(tx, tenantId)).timezone);
    const type = (await this.types.list(tx, tenantId)).find(
      (entry) => entry.id === account.typeId,
    )!;
    const lists = applicableLists(
      await this.refs(tx, tenantId),
      {
        id: account.id,
        type: type.key,
        segments: account.segments,
        territories: await this.territories.ancestors(tx, tenantId, account.territoryId),
      },
      day,
    );
    const entries = await this.entries(
      tx,
      tenantId,
      lists.map((list) => list.id),
    );
    const active = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.tenantId, tenantId), eq(items.active, true)))
      .orderBy(asc(items.code));
    return {
      date: day,
      lists: lists.map(({ id, name, scope }) => ({ id, name, scope })),
      items: active.flatMap(({ id }) => {
        const price = priceFor(id, lists, (listId, itemId) => entries.get(listId)?.get(itemId));
        return price ? [{ itemId: id, ...price, rate: netRate(price.price, price.discount) }] : [];
      }),
    };
  }

  /** The current entries of some lists, by list and item. */
  async entries(
    tx: TenantTx,
    tenantId: string,
    listIds: readonly string[],
  ): Promise<Map<string, Map<string, PriceEntry>>> {
    const result = new Map<string, Map<string, PriceEntry>>();
    if (listIds.length === 0) return result;
    const rows = await tx
      .select({
        listId: priceListItems.priceListId,
        itemId: priceListItems.itemId,
        price: priceListItems.price,
        discount: priceListItems.discount,
      })
      .from(priceListItems)
      .where(
        and(
          eq(priceListItems.tenantId, tenantId),
          inArray(priceListItems.priceListId, [...listIds]),
          isNull(priceListItems.removedAt),
        ),
      );
    for (const { listId, itemId, ...entry } of rows) {
      if (!result.has(listId)) result.set(listId, new Map());
      result.get(listId)!.set(itemId, entry);
    }
    return result;
  }

  private async counts(tx: TenantTx, tenantId: string, ids: readonly string[]) {
    if (ids.length === 0) return new Map<string, number>();
    const rows = await tx
      .select({ id: priceListItems.priceListId, count: count() })
      .from(priceListItems)
      .where(
        and(
          eq(priceListItems.tenantId, tenantId),
          inArray(priceListItems.priceListId, [...ids]),
          isNull(priceListItems.removedAt),
        ),
      )
      .groupBy(priceListItems.priceListId);
    return new Map(rows.map((row) => [row.id, row.count]));
  }

  private result(row: ListRow, itemCount: number): PriceListResult {
    return {
      id: row.id,
      name: row.name,
      scope: row.scope,
      targets: row.targets,
      priority: row.priority,
      validFrom: row.validFrom,
      validTo: row.validTo,
      active: row.active,
      version: row.version,
      itemCount,
      updatedAt: iso(row.updatedAt),
    };
  }
}
