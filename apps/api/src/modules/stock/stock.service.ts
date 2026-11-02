import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CountFlag,
  countResult,
  lineValue,
  movementsFromFulfilment,
  newId,
  type RecordStockBody,
  signedUnits,
  type StockCountBody,
  type StockCountResult,
  type StockLevelsResult,
  type StockMovementKind,
  type StockMovementResult,
  stockUnits,
  stockUnitsText,
  todayIn,
} from '@thelamp/shared';
import { and, desc, eq, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { stockCountLines, stockCounts, stockLevels, stockMovements } from '../../db/schema/stock';
import { AuditLog, type AuditActor, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountTypesService } from '../accounts/account-types.service';
import { AccountsService } from '../accounts/accounts.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import { PriceListsService } from '../catalogue/price-lists.service';
import { invalid } from '../iam/actor';
import { People } from '../iam/people';
import { OrdersService } from '../orders/orders.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

type MovementRow = typeof stockMovements.$inferSelect;
type CountRow = typeof stockCounts.$inferSelect;

/** Numbers as the database keeps them (`12.500`), back to plain decimal strings (`12.5`). */
const plain = (value: string) => stockUnitsText(stockUnits(value));

/** A movement to write: where, what, how much, and what it came from. */
export interface NewMovement {
  accountId: string;
  itemId: string;
  kind: StockMovementKind;
  /** Signed base units. */
  units: string;
  occurredOn: string;
  sourceType: 'order' | 'count' | 'entry' | 'import';
  sourceId: string | null;
  sourceLineId?: string | null;
  /** Makes an entry, a count or an imported row move stock once. */
  sourceKey?: string | null;
  note?: string | null;
  createdBy: string | null;
}

const cursorOf = (at: Date, id: string) =>
  Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
const fromCursor = (cursor: string | undefined) => {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const when = new Date(at ?? '');
  return id && !Number.isNaN(when.getTime()) ? { at: when, id } : null;
};

/**
 * Distributors' stock (module M24, BR-62, decision D130): levels per account and item, kept by a
 * ledger of movements (fulfilment, counts, entries and imports) while the tenant's `stockSource`
 * is `kept`, or loaded from the books while it is `books`. Only accounts of a type that keeps
 * stock hold any; nothing here refuses an order or a count for want of stock.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly types: AccountTypesService,
    private readonly catalogue: CatalogueService,
    private readonly prices: PriceListsService,
    private readonly people: People,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
    private readonly orders: OrdersService,
  ) {}

  /** Whether each account's type keeps stock. */
  async keepsStock(
    tx: TenantTx,
    tenantId: string,
    accountIds: readonly string[],
  ): Promise<Map<string, boolean>> {
    const typeOf = await this.accounts.typesOf(tx, tenantId, accountIds);
    const keeps = new Map<string, boolean>();
    for (const typeId of new Set(typeOf.values())) {
      keeps.set(typeId, (await this.types.byId(tx, tenantId, typeId)).definition.keepsStock);
    }
    return new Map([...typeOf].map(([id, typeId]) => [id, keeps.get(typeId) ?? false]));
  }

  /** An account the caller reaches, of a type that keeps stock. */
  async holder(tx: TenantTx, access: Access, accountId: string, path = 'accountId') {
    const row = await this.accounts.find(tx, access, accountId);
    const type = await this.types.byId(tx, access.tenantId, row.typeId);
    if (!type.definition.keepsStock) throw invalid(path, 'This kind of account holds no stock');
    return row;
  }

  /** Each item's level at an account, as kept or loaded, by item. */
  async onHand(
    tx: TenantTx,
    tenantId: string,
    accountId: string,
  ): Promise<Map<string, { onHand: string; movedAt: Date | null; countedOn: string | null }>> {
    const rows = await tx
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.tenantId, tenantId), eq(stockLevels.accountId, accountId)));
    return new Map(
      rows.map((row) => [
        row.itemId,
        { onHand: plain(row.onHand), movedAt: row.movedAt, countedOn: row.countedOn },
      ]),
    );
  }

  /** `GET /v1/accounts/{id}/stock`: every item the account holds or held, valued at its prices. */
  async levels(tx: TenantTx, access: Access, accountId: string): Promise<StockLevelsResult> {
    const tenantId = access.tenantId;
    await this.holder(tx, access, accountId, 'id');
    const settings = await this.config.settings(tx, tenantId);
    const levels = await this.onHand(tx, tenantId, accountId);
    const items = new Map(
      (await this.catalogue.items(tx, tenantId, [...levels.keys()])).map((item) => [item.id, item]),
    );
    const priced = await this.prices.forAccount(tx, access, accountId);
    const rates = new Map(priced.items.map((entry) => [entry.itemId, entry.rate]));
    const rows = [...levels]
      .flatMap(([itemId, level]) => {
        const item = items.get(itemId);
        if (!item) return [];
        // A negative level is shown as it is, and valued at nothing.
        const value = level.onHand.startsWith('-')
          ? null
          : lineValue(level.onHand, rates.get(itemId) ?? null);
        return [
          {
            item: { id: item.id, code: item.code, name: item.name, baseUnit: item.baseUnit },
            onHand: level.onHand,
            value,
            movedAt: level.movedAt?.toISOString() ?? null,
            countedOn: level.countedOn,
          },
        ];
      })
      .sort((a, b) => a.item.code.localeCompare(b.item.code));
    const known = rows.map((row) => row.value).filter((value): value is string => value !== null);
    return {
      accountId,
      source: settings.stockSource,
      items: rows,
      value:
        known.length === 0
          ? null
          : stockUnitsText(known.reduce((sum, value) => sum + stockUnits(value), 0n)),
    };
  }

  /** Writes movements and moves each level by them, in the caller's transaction. */
  async apply(
    tx: TenantTx,
    tenantId: string,
    movements: readonly NewMovement[],
  ): Promise<MovementRow[]> {
    if (movements.length === 0) return [];
    const now = new Date();
    const written = await tx
      .insert(stockMovements)
      .values(
        movements.map((movement) => ({
          tenantId,
          id: newId(),
          accountId: movement.accountId,
          itemId: movement.itemId,
          kind: movement.kind,
          units: movement.units,
          occurredOn: movement.occurredOn,
          sourceType: movement.sourceType,
          sourceId: movement.sourceId,
          sourceLineId: movement.sourceLineId ?? null,
          sourceKey: movement.sourceKey ?? null,
          note: movement.note ?? null,
          createdBy: movement.createdBy,
          createdAt: now,
        })),
      )
      .onConflictDoNothing()
      .returning();
    for (const movement of written) {
      await tx
        .insert(stockLevels)
        .values({
          tenantId,
          accountId: movement.accountId,
          itemId: movement.itemId,
          onHand: movement.units,
          movedAt: now,
        })
        .onConflictDoUpdate({
          target: [stockLevels.tenantId, stockLevels.accountId, stockLevels.itemId],
          set: {
            onHand: sql`${stockLevels.onHand} + excluded.on_hand`,
            movedAt: sql`excluded.moved_at`,
          },
        });
    }
    return written;
  }

  /**
   * Moves stock for a fulfilment (BR-62): each accepted line's units fulfilled since stock last
   * moved for it, into a buyer and out of a supplying account whose types keep stock. Delivered at
   * least once, so it moves only the difference, under a lock on the order.
   */
  async fromOrder(tx: TenantTx, tenantId: string, orderId: string): Promise<number> {
    const settings = await this.config.settings(tx, tenantId);
    if (settings.modulesOff.includes('inventory') || settings.stockSource !== 'kept') return 0;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`stock:order:${tenantId}:${orderId}`}, 0))`,
    );
    const order = await this.orders.forStock(tx, tenantId, orderId);
    if (!order) return 0;
    const supplierId = order.supplierKind === 'account' ? order.supplierAccountId : null;
    const keeps = await this.keepsStock(tx, tenantId, [
      order.accountId,
      ...(supplierId ? [supplierId] : []),
    ]);
    if (!keeps.get(order.accountId) && !(supplierId && keeps.get(supplierId))) return 0;
    const moved = order.lines.length
      ? await tx
          .select({
            lineId: stockMovements.sourceLineId,
            accountId: stockMovements.accountId,
            units: sql<string>`sum(${stockMovements.units})`,
          })
          .from(stockMovements)
          .where(
            and(
              eq(stockMovements.tenantId, tenantId),
              inArray(
                stockMovements.sourceLineId,
                order.lines.map((line) => line.lineId),
              ),
            ),
          )
          .groupBy(stockMovements.sourceLineId, stockMovements.accountId)
      : [];
    const movedBy = (lineId: string, accountId: string | null) => {
      const found = moved.find((row) => row.lineId === lineId && row.accountId === accountId);
      return found ? stockUnitsText(stockUnits(found.units.replace(/^-/, ''))) : '0';
    };
    const today = todayIn(settings.timezone);
    const movements = movementsFromFulfilment({
      buyer: { accountId: order.accountId, keepsStock: keeps.get(order.accountId) ?? false },
      supplier: supplierId
        ? { accountId: supplierId, keepsStock: keeps.get(supplierId) ?? false }
        : null,
      lines: order.lines.map((line) => ({
        lineId: line.lineId,
        itemId: line.itemId,
        fulfilled: line.fulfilledUnits ? plain(line.fulfilledUnits) : '0',
        movedIn: movedBy(line.lineId, order.accountId),
        movedOut: movedBy(line.lineId, supplierId),
      })),
    });
    await this.apply(
      tx,
      tenantId,
      movements.map((movement) => ({
        accountId: movement.accountId,
        itemId: movement.itemId,
        kind: movement.kind,
        units: movement.units,
        occurredOn: today,
        sourceType: 'order',
        sourceId: orderId,
        sourceLineId: movement.lineId,
        createdBy: null,
      })),
    );
    return movements.length;
  }

  /** Refuses what only a kept ledger takes while the books keep stock. */
  private async kept(
    tx: TenantTx,
    tenantId: string,
  ): Promise<{ timezone: string; tolerance: number }> {
    const settings = await this.config.settings(tx, tenantId);
    if (settings.stockSource !== 'kept') {
      throw new AppError('CONFLICT', 'Stock comes from the books here; load it instead.');
    }
    return { timezone: settings.timezone, tolerance: settings.countTolerancePct };
  }

  /** The items named, each one of the catalogue's; a missing one is refused by its line. */
  private async itemsOf(tx: TenantTx, tenantId: string, ids: readonly string[]) {
    const items = new Map(
      (await this.catalogue.items(tx, tenantId, ids)).map((item) => [item.id, item]),
    );
    ids.forEach((id, index) => {
      if (!items.has(id)) throw invalid(`lines.${index}.itemId`, 'Choose an item of the catalogue');
    });
    return items;
  }

  /**
   * `POST /v1/stock/movements`: goods in or out by hand (BR-62), only while the app keeps stock.
   * The body's ID makes it move stock once.
   */
  async record(
    tx: TenantTx,
    access: Access,
    body: RecordStockBody,
    actor: AuditActor = userActor(access),
  ): Promise<{ id: string; movements: StockMovementResult[] }> {
    const tenantId = access.tenantId;
    await this.holder(tx, access, body.accountId);
    const { timezone } = await this.kept(tx, tenantId);
    const items = await this.itemsOf(
      tx,
      tenantId,
      body.lines.map((line) => line.itemId),
    );
    const occurredOn = body.occurredOn ?? todayIn(timezone);
    const written = await this.apply(
      tx,
      tenantId,
      body.lines.map((line) => ({
        accountId: body.accountId,
        itemId: line.itemId,
        kind: body.kind,
        units: signedUnits(body.kind, line.quantity),
        occurredOn,
        sourceType: 'entry',
        sourceId: body.id,
        sourceKey: `entry:${body.id}:${line.itemId}`,
        note: body.note ?? null,
        createdBy: access.apiClient ? null : access.userId,
      })),
    );
    await this.audit.record(tx, tenantId, actor, {
      action: 'stock.recorded',
      target: { type: 'account', id: body.accountId },
      after: {
        entryId: body.id,
        kind: body.kind,
        occurredOn,
        lines: body.lines.map((line) => ({
          item: items.get(line.itemId)!.code,
          quantity: line.quantity,
        })),
      },
    });
    return { id: body.id, movements: await this.results(tx, tenantId, written) };
  }

  /**
   * `POST /v1/stock/counts`: what a person counted (BR-62). While the app keeps stock it adjusts
   * each item to the count at once, flagging differences past the tolerance; while the books keep
   * it, the count is kept as seen beside the books' levels and moves nothing.
   */
  async count(tx: TenantTx, access: Access, body: StockCountBody): Promise<StockCountResult> {
    const tenantId = access.tenantId;
    await this.holder(tx, access, body.accountId);
    const settings = await this.config.settings(tx, tenantId);
    const items = await this.itemsOf(
      tx,
      tenantId,
      body.lines.map((line) => line.itemId),
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`stock:account:${tenantId}:${body.accountId}`}, 0))`,
    );
    const levels = await this.onHand(tx, tenantId, body.accountId);
    const countedAt = body.countedAt ? new Date(body.countedAt) : new Date();
    const countedOn = todayIn(settings.timezone, countedAt);
    const lines = body.lines.map((line) => {
      const expected = levels.get(line.itemId)?.onHand ?? '0';
      return {
        itemId: line.itemId,
        counted: plain(line.counted),
        expected,
        ...countResult(expected, line.counted, settings.countTolerancePct),
      };
    });
    const flagged = lines.some((line) => line.flags.length > 0);
    await tx.insert(stockCounts).values({
      tenantId,
      id: body.id,
      accountId: body.accountId,
      countedAt,
      countedBy: access.userId,
      note: body.note ?? null,
      flagged,
    });
    await tx.insert(stockCountLines).values(
      lines.map((line) => ({
        tenantId,
        countId: body.id,
        itemId: line.itemId,
        counted: line.counted,
        expected: line.expected,
        difference: line.difference,
        flags: line.flags,
      })),
    );
    if (settings.stockSource === 'kept') {
      await this.apply(
        tx,
        tenantId,
        lines
          .filter((line) => line.difference !== '0')
          .map((line) => ({
            accountId: body.accountId,
            itemId: line.itemId,
            kind: 'counted' as const,
            units: line.difference,
            occurredOn: countedOn,
            sourceType: 'count' as const,
            sourceId: body.id,
            sourceKey: `count:${body.id}:${line.itemId}`,
            note: body.note ?? null,
            createdBy: access.userId,
          })),
      );
    }
    for (const line of lines) {
      await tx
        .insert(stockLevels)
        .values({
          tenantId,
          accountId: body.accountId,
          itemId: line.itemId,
          onHand: settings.stockSource === 'kept' ? line.counted : line.expected,
          countedOn,
        })
        .onConflictDoUpdate({
          target: [stockLevels.tenantId, stockLevels.accountId, stockLevels.itemId],
          set: { countedOn: sql`excluded.counted_on` },
        });
    }
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'stock.counted',
      target: { type: 'account', id: body.accountId },
      after: {
        countId: body.id,
        flagged,
        lines: lines.map((line) => ({
          item: items.get(line.itemId)!.code,
          counted: line.counted,
          expected: line.expected,
        })),
      },
    });
    return this.countResultOf(tx, tenantId, body.id);
  }

  /** Audits movements a file or the bulk API brought, once a load. */
  async imported(tx: TenantTx, tenantId: string, actor: AuditActor, movements: number) {
    await this.audit.record(tx, tenantId, actor, {
      action: 'stock.recorded',
      target: { type: 'stock', id: null },
      after: { imported: movements },
    });
  }

  /** Sets levels to what the books say (BR-62): loaded while the books keep stock, or as openings. */
  async load(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    createdBy: string | null,
    rows: readonly { accountId: string; itemId: string; onHand: string; asOf: string }[],
    reference: string,
  ): Promise<{ created: number; updated: number }> {
    const settings = await this.config.settings(tx, tenantId);
    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const [before] = await tx
        .select()
        .from(stockLevels)
        .where(
          and(
            eq(stockLevels.tenantId, tenantId),
            eq(stockLevels.accountId, row.accountId),
            eq(stockLevels.itemId, row.itemId),
          ),
        )
        .for('update');
      const current = before ? plain(before.onHand) : null;
      if (current === plain(row.onHand)) continue;
      if (settings.stockSource === 'kept') {
        // While the app keeps stock, a level loaded is an opening: the ledger moves to it.
        await this.apply(tx, tenantId, [
          {
            accountId: row.accountId,
            itemId: row.itemId,
            kind: 'opening',
            units: stockUnitsText(stockUnits(row.onHand) - stockUnits(current ?? '0')),
            occurredOn: row.asOf,
            sourceType: 'import',
            sourceId: null,
            note: reference,
            createdBy,
          },
        ]);
      } else {
        await tx
          .insert(stockLevels)
          .values({
            tenantId,
            accountId: row.accountId,
            itemId: row.itemId,
            onHand: row.onHand,
            movedAt: new Date(`${row.asOf}T00:00:00Z`),
          })
          .onConflictDoUpdate({
            target: [stockLevels.tenantId, stockLevels.accountId, stockLevels.itemId],
            set: { onHand: sql`excluded.on_hand`, movedAt: sql`excluded.moved_at` },
          });
      }
      if (before) updated += 1;
      else created += 1;
    }
    if (created + updated > 0) {
      await this.audit.record(tx, tenantId, actor, {
        action: 'stock.loaded',
        target: { type: 'stock', id: null },
        after: { source: settings.stockSource, reference, created, updated },
      });
    }
    return { created, updated };
  }

  /** `GET /v1/accounts/{id}/stock/movements`: the account's movements, newest first. */
  async movements(
    tx: TenantTx,
    access: Access,
    accountId: string,
    query: { itemId?: string; cursor?: string; limit: number },
  ): Promise<{ items: StockMovementResult[]; nextCursor: string | null }> {
    const tenantId = access.tenantId;
    await this.holder(tx, access, accountId, 'id');
    const after = fromCursor(query.cursor);
    const rows = await tx
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.tenantId, tenantId),
          eq(stockMovements.accountId, accountId),
          query.itemId ? eq(stockMovements.itemId, query.itemId) : undefined,
          after
            ? or(
                lt(stockMovements.createdAt, after.at),
                and(eq(stockMovements.createdAt, after.at), lt(stockMovements.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: await this.results(tx, tenantId, page),
      nextCursor: rows.length > query.limit && last ? cursorOf(last.createdAt, last.id) : null,
    };
  }

  /** `GET /v1/accounts/{id}/stock/counts`: the account's counts, newest first. */
  async counts(
    tx: TenantTx,
    access: Access,
    accountId: string,
    query: { cursor?: string; limit: number },
  ): Promise<{ items: StockCountResult[]; nextCursor: string | null }> {
    const tenantId = access.tenantId;
    await this.holder(tx, access, accountId, 'id');
    const after = fromCursor(query.cursor);
    const rows: CountRow[] = await tx
      .select()
      .from(stockCounts)
      .where(
        and(
          eq(stockCounts.tenantId, tenantId),
          eq(stockCounts.accountId, accountId),
          after
            ? or(
                lt(stockCounts.countedAt, after.at),
                and(eq(stockCounts.countedAt, after.at), lt(stockCounts.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(stockCounts.countedAt), desc(stockCounts.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: await Promise.all(page.map((row) => this.countResultOf(tx, tenantId, row.id))),
      nextCursor: rows.length > query.limit && last ? cursorOf(last.countedAt, last.id) : null,
    };
  }

  /** A count as answered, with its lines and who counted. */
  async countResultOf(tx: TenantTx, tenantId: string, id: string): Promise<StockCountResult> {
    const [row] = await tx
      .select()
      .from(stockCounts)
      .where(and(eq(stockCounts.tenantId, tenantId), eq(stockCounts.id, id)));
    const lines = await tx
      .select()
      .from(stockCountLines)
      .where(and(eq(stockCountLines.tenantId, tenantId), eq(stockCountLines.countId, id)));
    const items = new Map(
      (
        await this.catalogue.items(
          tx,
          tenantId,
          lines.map((line) => line.itemId),
        )
      ).map((item) => [item.id, item]),
    );
    const by = row!.countedBy
      ? (await this.people.facts(tx, tenantId, [row!.countedBy])).get(row!.countedBy)
      : undefined;
    return {
      id: row!.id,
      accountId: row!.accountId,
      countedAt: row!.countedAt.toISOString(),
      by: by ? { id: by.id, name: by.name } : null,
      note: row!.note,
      flagged: row!.flagged,
      lines: lines
        .flatMap((line) => {
          const item = items.get(line.itemId);
          if (!item) return [];
          return [
            {
              item: { id: item.id, code: item.code, name: item.name, baseUnit: item.baseUnit },
              counted: plain(line.counted),
              expected: plain(line.expected),
              difference: plain(line.difference),
              flags: line.flags as CountFlag[],
            },
          ];
        })
        .sort((a, b) => a.item.code.localeCompare(b.item.code)),
    };
  }

  /** Movements as answered, with their items and people. */
  private async results(
    tx: TenantTx,
    tenantId: string,
    rows: readonly MovementRow[],
  ): Promise<StockMovementResult[]> {
    const items = new Map(
      (
        await this.catalogue.items(
          tx,
          tenantId,
          rows.map((row) => row.itemId),
        )
      ).map((item) => [item.id, item]),
    );
    const people = await this.people.facts(
      tx,
      tenantId,
      rows.flatMap((row) => (row.createdBy ? [row.createdBy] : [])),
    );
    return rows.flatMap((row) => {
      const item = items.get(row.itemId);
      if (!item) return [];
      const by = row.createdBy ? people.get(row.createdBy) : undefined;
      return [
        {
          id: row.id,
          kind: row.kind,
          item: { id: item.id, code: item.code, name: item.name, baseUnit: item.baseUnit },
          units: plain(row.units),
          occurredOn: row.occurredOn,
          source: { type: row.sourceType, id: row.sourceId },
          note: row.note,
          by: by ? { id: by.id, name: by.name } : null,
          createdAt: row.createdAt.toISOString(),
        },
      ];
    });
  }

  /** A page of a month's movements among the accounts given, for reports, oldest first. */
  async ledgerRows(
    tx: TenantTx,
    tenantId: string,
    reach: SQL,
    from: string,
    to: string,
    offset: number,
    limit: number,
  ): Promise<{ rows: MovementRow[]; more: boolean }> {
    const rows = await tx
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.tenantId, tenantId),
          // The reach is account IDs as text (`AccountsService.reachIds`).
          sql`${stockMovements.accountId}::text in (${reach})`,
          sql`${stockMovements.occurredOn} between ${from} and ${to}`,
        ),
      )
      .orderBy(stockMovements.occurredOn, stockMovements.createdAt, stockMovements.id)
      .offset(offset)
      .limit(limit + 1);
    return { rows: rows.slice(0, limit), more: rows.length > limit };
  }

  /** A page of the levels among the accounts given, for reports, by account and item. */
  async levelRows(tx: TenantTx, tenantId: string, reach: SQL, offset: number, limit: number) {
    const rows = await tx
      .select()
      .from(stockLevels)
      .where(
        and(eq(stockLevels.tenantId, tenantId), sql`${stockLevels.accountId}::text in (${reach})`),
      )
      .orderBy(stockLevels.accountId, stockLevels.itemId)
      .offset(offset)
      .limit(limit + 1);
    return {
      rows: rows.slice(0, limit).map((row) => ({ ...row, onHand: plain(row.onHand) })),
      more: rows.length > limit,
    };
  }

  /** What each item is worth at each account's prices today, by account then item. */
  async ratesFor(tx: TenantTx, access: Access, accountIds: readonly string[]) {
    const rates = new Map<string, Map<string, string>>();
    for (const accountId of new Set(accountIds)) {
      const priced = await this.prices.forAccount(tx, access, accountId);
      rates.set(accountId, new Map(priced.items.map((entry) => [entry.itemId, entry.rate])));
    }
    return rates;
  }
}
