import { Injectable } from '@nestjs/common';
import {
  AppError,
  creditedDate,
  lineValue,
  previousPeriod,
  type SaveSellThroughBody,
  type SellThroughFlag,
  type SellThroughLine,
  type SellThroughLineBody,
  type SellThroughResult,
  type SellThroughVersion,
  scaled,
  soldThrough,
  statementLineFlags,
  statementOpen,
  todayIn,
  unscaled,
} from '@thelamp/shared';
import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { items } from '../../db/schema/catalogue';
import { sellThroughLines, sellThroughStatements } from '../../db/schema/sell-through';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { AccountTypesService } from '../accounts/account-types.service';
import { AccountsService } from '../accounts/accounts.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import { PriceListsService } from '../catalogue/price-lists.service';
import { invalid, notFound } from '../iam/actor';
import { People } from '../iam/people';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

type Statement = typeof sellThroughStatements.$inferSelect;
type Line = typeof sellThroughLines.$inferSelect;

/** Numbers as the database keeps them, back to plain decimal strings. */
export const plain = (value: string) => {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
  const text = fraction.replace(/0+$/, '') ? `${whole}.${fraction.replace(/0+$/, '')}` : whole;
  return negative && text !== '0' ? `-${text}` : text;
};

/** A version's lines summed to its value; null when no line had a price. */
function totalOf(values: readonly (string | null)[]): string | null {
  const known = values.filter((value): value is string => value !== null);
  if (known.length === 0) return null;
  const sum = known.reduce(
    (total, value) =>
      total + (value.startsWith('-') ? -scaled(value.slice(1), 2) : scaled(value, 2)),
    0n,
  );
  return sum < 0n ? `-${unscaled(-sum, 2)}` : unscaled(sum, 2);
}

/** What one person or file sends for an account's month. */
export interface StatementInput {
  id: string;
  accountId: string;
  period: string;
  lines: readonly SellThroughLineBody[];
  /** Whose figures it counts in; the caller's own when left out (BR-53). */
  creditTo?: string;
}

/**
 * Sell-through by item (BR-53, decision D124): accounts of a type that reports it give a monthly
 * stock statement, kept as versions. Each version holds every item's line, the latest counts, and
 * it is valued at the account's prices on the day it counts on.
 */
@Injectable()
export class SellThroughService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly types: AccountTypesService,
    private readonly catalogue: CatalogueService,
    private readonly prices: PriceListsService,
    private readonly people: People,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
  ) {}

  /** An account the caller reaches, of a type that reports sell-through. */
  private async account(tx: TenantTx, access: Access, accountId: string, path = 'accountId') {
    const row = await this.accounts.find(tx, access, accountId);
    const type = await this.types.byId(tx, access.tenantId, row.typeId);
    if (!type.definition.sellThrough) {
      throw invalid(path, 'This kind of account gives no stock statement');
    }
    return row;
  }

  /** An account's versions of a month, newest first. */
  private async versions(
    tx: TenantTx,
    tenantId: string,
    accountId: string,
    period: string,
  ): Promise<Statement[]> {
    return tx
      .select()
      .from(sellThroughStatements)
      .where(
        and(
          eq(sellThroughStatements.tenantId, tenantId),
          eq(sellThroughStatements.accountId, accountId),
          eq(sellThroughStatements.period, period),
        ),
      )
      .orderBy(desc(sellThroughStatements.version));
  }

  private async linesOf(tx: TenantTx, tenantId: string, statementId: string): Promise<Line[]> {
    return tx
      .select()
      .from(sellThroughLines)
      .where(
        and(eq(sellThroughLines.tenantId, tenantId), eq(sellThroughLines.statementId, statementId)),
      );
  }

  /** Last month's closing for each item, from its latest version (BR-53). */
  private async carried(
    tx: TenantTx,
    tenantId: string,
    accountId: string,
    period: string,
  ): Promise<Map<string, string>> {
    const [latest] = await this.versions(tx, tenantId, accountId, previousPeriod(period));
    if (!latest) return new Map();
    return new Map(
      (await this.linesOf(tx, tenantId, latest.id)).map((line) => [
        line.itemId,
        plain(line.closing),
      ]),
    );
  }

  /**
   * Saves a new version of an account's month: the lines sent, over the latest version's others.
   * Refused for a month that is closed (`PERIOD_CLOSED`) or not yet begun; odd figures are flagged.
   */
  async record(tx: TenantTx, access: Access, input: StatementInput): Promise<SellThroughResult> {
    const tenantId = access.tenantId;
    await this.account(tx, access, input.accountId);
    const { timezone } = await this.config.settings(tx, tenantId);
    const today = todayIn(timezone);
    if (!statementOpen(input.period, today)) {
      throw new AppError('PERIOD_CLOSED', 'That month’s statement can no longer change.');
    }
    const creditTo = input.creditTo ?? access.userId;
    if (!input.creditTo && (access.support || access.apiClient)) {
      throw new AppError('FORBIDDEN', 'Only a person of the organisation records a statement.');
    }
    const items = new Map(
      (await this.catalogue.items(tx, tenantId)).map((item) => [item.id, item]),
    );
    input.lines.forEach((line, index) => {
      if (!items.get(line.itemId)?.active) {
        throw invalid(`lines[${index}].itemId`, 'There is no such item');
      }
    });
    // One account's month takes turns, so two saves never take the same version number.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`sell_through:${tenantId}:${input.accountId}:${input.period}`}, 0))`,
    );
    const [latest] = await this.versions(tx, tenantId, input.accountId, input.period);
    const before = latest ? await this.linesOf(tx, tenantId, latest.id) : [];
    const carried = await this.carried(tx, tenantId, input.accountId, input.period);
    const creditedOn = creditedDate(input.period, today);
    const priced = await this.prices.forAccount(tx, access, input.accountId, creditedOn);
    const rates = new Map(priced.items.map((entry) => [entry.itemId, entry.rate]));

    const merged = new Map(
      before.map((line) => [
        line.itemId,
        {
          opening: plain(line.opening),
          received: plain(line.received),
          returned: plain(line.returned),
          closing: plain(line.closing),
        },
      ]),
    );
    for (const line of input.lines) {
      merged.set(line.itemId, {
        opening:
          line.opening ?? merged.get(line.itemId)?.opening ?? carried.get(line.itemId) ?? '0',
        received: line.received,
        returned: line.returned,
        closing: line.closing,
      });
    }
    const rows = [...merged].map(([itemId, stock]) => {
      const sold = soldThrough(stock);
      const unitPrice = rates.get(itemId) ?? null;
      const flags: SellThroughFlag[] = [
        ...statementLineFlags(stock, carried.get(itemId) ?? null),
        ...(unitPrice === null ? (['no_price'] as const) : []),
      ];
      return { itemId, ...stock, sold, unitPrice, value: lineValue(sold, unitPrice), flags };
    });
    const version = (latest?.version ?? 0) + 1;
    const flags = [...new Set(rows.flatMap((row) => row.flags))];
    const value = totalOf(rows.map((row) => row.value));
    await tx.insert(sellThroughStatements).values({
      id: input.id,
      tenantId,
      accountId: input.accountId,
      period: input.period,
      version,
      recordedBy: creditTo,
      creditedOn,
      value,
      flags,
    });
    await tx
      .insert(sellThroughLines)
      .values(rows.map((row) => ({ tenantId, statementId: input.id, ...row })));
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'sell_through.recorded',
      target: { type: 'account', id: input.accountId },
      after: {
        period: input.period,
        version,
        lines: input.lines.length,
        value,
        creditedTo: creditTo,
      },
    });
    await this.outbox.publish(tx, tenantId, 'sell_through.recorded', input.id, {
      statementId: input.id,
      accountId: input.accountId,
      period: input.period,
      version,
      userId: creditTo,
      creditedOn,
      previous: latest ? { userId: latest.recordedBy, creditedOn: latest.creditedOn } : null,
    });
    return this.get(tx, access, input.accountId, input.period);
  }

  /** The person's own statement from their phone or the API: it counts for them. */
  async save(
    tx: TenantTx,
    access: Access,
    accountId: string,
    period: string,
    body: SaveSellThroughBody,
  ): Promise<SellThroughResult> {
    return this.record(tx, access, { id: body.id, accountId, period, lines: body.lines });
  }

  /** An account's month: the latest version, or the one asked for, and every version. */
  async get(
    tx: TenantTx,
    access: Access,
    accountId: string,
    period: string,
    version?: number,
  ): Promise<SellThroughResult> {
    const tenantId = access.tenantId;
    const account = await this.account(tx, access, accountId);
    const versions = await this.versions(tx, tenantId, accountId, period);
    const shown =
      version === undefined ? versions[0] : versions.find((entry) => entry.version === version);
    if (version !== undefined && !shown) throw notFound();
    const lines = shown ? await this.linesOf(tx, tenantId, shown.id) : [];
    const carried = await this.carried(tx, tenantId, accountId, period);
    const items = new Map(
      (await this.catalogue.items(tx, tenantId)).map((item) => [item.id, item]),
    );
    const people = await this.people.facts(
      tx,
      tenantId,
      versions.map((entry) => entry.recordedBy),
    );
    const { timezone } = await this.config.settings(tx, tenantId);
    const versionOf = (entry: Statement): SellThroughVersion => ({
      id: entry.id,
      version: entry.version,
      recordedBy: {
        id: entry.recordedBy,
        code: people.get(entry.recordedBy)?.code ?? '',
        name: people.get(entry.recordedBy)?.name ?? '',
      },
      recordedAt: entry.recordedAt.toISOString(),
      creditedOn: entry.creditedOn,
      value: entry.value,
    });
    const lineOf = (line: Line): SellThroughLine => {
      const item = items.get(line.itemId);
      return {
        item: {
          id: line.itemId,
          code: item?.code ?? '',
          name: item?.name ?? '',
          baseUnit: item?.baseUnit ?? '',
        },
        opening: plain(line.opening),
        received: plain(line.received),
        returned: plain(line.returned),
        closing: plain(line.closing),
        sold: plain(line.sold),
        carried: carried.get(line.itemId) ?? null,
        unitPrice: line.unitPrice,
        value: line.value,
        flags: line.flags,
      };
    };
    const inLines = new Set(lines.map((line) => line.itemId));
    return {
      account: { id: account.id, code: account.code, name: account.name },
      period,
      open: statementOpen(period, todayIn(timezone)),
      statement: shown
        ? {
            ...versionOf(shown),
            flags: shown.flags,
            lines: lines.map(lineOf).sort((a, b) => a.item.code.localeCompare(b.item.code)),
          }
        : null,
      carried: [...carried]
        .filter(([itemId]) => !inLines.has(itemId))
        .map(([itemId, closing]) => ({ itemId, closing })),
      versions: versions.map(versionOf),
    };
  }

  /** What these accounts sold through of each item in a month, by their latest versions. */
  async soldFor(
    tx: TenantTx,
    tenantId: string,
    accountIds: readonly string[],
    period: string,
  ): Promise<Map<string, Map<string, string>>> {
    const result = new Map<string, Map<string, string>>();
    if (accountIds.length === 0) return result;
    const rows = await tx
      .select({
        accountId: sellThroughStatements.accountId,
        itemId: sellThroughLines.itemId,
        sold: sellThroughLines.sold,
      })
      .from(sellThroughStatements)
      .innerJoin(
        sellThroughLines,
        and(
          eq(sellThroughLines.tenantId, sellThroughStatements.tenantId),
          eq(sellThroughLines.statementId, sellThroughStatements.id),
        ),
      )
      .where(
        and(
          eq(sellThroughStatements.tenantId, tenantId),
          eq(sellThroughStatements.period, period),
          inArray(sellThroughStatements.accountId, [...accountIds]),
          sql`not exists (
            select 1 from ${sellThroughStatements} later
             where later.tenant_id = ${sellThroughStatements.tenantId}
               and later.account_id = ${sellThroughStatements.accountId}
               and later.period = ${sellThroughStatements.period}
               and later.version > ${sellThroughStatements.version})`,
        ),
      );
    for (const row of rows) {
      const items = result.get(row.accountId) ?? new Map<string, string>();
      items.set(row.itemId, plain(row.sold));
      result.set(row.accountId, items);
    }
    return result;
  }

  /**
   * The lines credited to a person on a day (BR-53), from the latest version of each account's
   * month, for the metric engine.
   */
  async forMetrics(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    date: string,
  ): Promise<{ itemCode: string; sold: string; value: string | null }[]> {
    // The latest version of each account's month: no later version of it exists.
    const statements = await tx
      .select({ id: sellThroughStatements.id })
      .from(sellThroughStatements)
      .where(
        and(
          eq(sellThroughStatements.tenantId, tenantId),
          eq(sellThroughStatements.recordedBy, userId),
          eq(sellThroughStatements.creditedOn, date),
          sql`not exists (
            select 1 from ${sellThroughStatements} later
             where later.tenant_id = ${sellThroughStatements.tenantId}
               and later.account_id = ${sellThroughStatements.accountId}
               and later.period = ${sellThroughStatements.period}
               and later.version > ${sellThroughStatements.version})`,
        ),
      );
    if (statements.length === 0) return [];
    const lines = await tx
      .select({
        itemId: sellThroughLines.itemId,
        sold: sellThroughLines.sold,
        value: sellThroughLines.value,
      })
      .from(sellThroughLines)
      .where(
        and(
          eq(sellThroughLines.tenantId, tenantId),
          inArray(
            sellThroughLines.statementId,
            statements.map((row) => row.id),
          ),
        ),
      );
    const codes = new Map(
      (await this.catalogue.items(tx, tenantId)).map((item) => [item.id, item.code]),
    );
    return lines.map((line) => ({
      itemCode: codes.get(line.itemId) ?? '',
      sold: line.sold,
      value: line.value,
    }));
  }

  /**
   * The latest version's lines of a month for the accounts in `accounts` (a subquery of IDs the
   * caller reaches), by account and item code, a page at a time, for the report.
   */
  async reportRows(
    tx: TenantTx,
    tenantId: string,
    accounts: SQL,
    period: string,
    offset: number,
    limit: number,
  ) {
    const rows = await tx
      .select({
        accountId: sellThroughStatements.accountId,
        recordedBy: sellThroughStatements.recordedBy,
        recordedAt: sellThroughStatements.recordedAt,
        line: sellThroughLines,
        itemCode: items.code,
        itemName: items.name,
      })
      .from(sellThroughStatements)
      .innerJoin(
        sellThroughLines,
        and(
          eq(sellThroughLines.tenantId, sellThroughStatements.tenantId),
          eq(sellThroughLines.statementId, sellThroughStatements.id),
        ),
      )
      .innerJoin(
        items,
        and(eq(items.tenantId, sellThroughLines.tenantId), eq(items.id, sellThroughLines.itemId)),
      )
      .where(
        and(
          eq(sellThroughStatements.tenantId, tenantId),
          eq(sellThroughStatements.period, period),
          sql`${sellThroughStatements.accountId}::text in (${accounts})`,
          sql`not exists (
            select 1 from ${sellThroughStatements} later
             where later.tenant_id = ${sellThroughStatements.tenantId}
               and later.account_id = ${sellThroughStatements.accountId}
               and later.period = ${sellThroughStatements.period}
               and later.version > ${sellThroughStatements.version})`,
        ),
      )
      .orderBy(sellThroughStatements.accountId, items.code)
      .offset(offset)
      .limit(limit + 1);
    return {
      more: rows.length > limit,
      rows: rows.slice(0, limit).map(({ line, ...row }) => ({
        ...row,
        opening: plain(line.opening),
        received: plain(line.received),
        returned: plain(line.returned),
        closing: plain(line.closing),
        sold: plain(line.sold),
        unitPrice: line.unitPrice,
        value: line.value,
        flags: line.flags,
      })),
    };
  }
}
