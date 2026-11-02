import { Injectable } from '@nestjs/common';
import type { MessageKey } from '@thelamp/i18n';
import { lineValue } from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import { People } from '../iam/people';
import { StockService } from '../stock/stock.service';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/**
 * Stock on hand (M18, BR-62, decision D130): what every account the caller sees holds of each
 * item, valued at the account's prices today, with when it last moved and was counted.
 */
@Injectable()
export class StockOnHandReport extends ReportSource {
  readonly key = 'stock_on_hand' as const;

  constructor(
    private readonly accounts: AccountsService,
    private readonly catalogue: CatalogueService,
    private readonly stock: StockService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'account_code', label: 'report.col_account_code', kind: 'text' },
      { key: 'account_name', label: 'report.col_account_name', kind: 'text' },
      { key: 'account_type', label: 'report.col_account_type', kind: 'text' },
      { key: 'item_code', label: 'report.col_item_code', kind: 'text' },
      { key: 'item_name', label: 'report.col_item_name', kind: 'text' },
      { key: 'unit', label: 'report.col_unit', kind: 'text' },
      { key: 'on_hand', label: 'report.col_on_hand', kind: 'decimal' },
      { key: 'unit_price', label: 'report.col_price', kind: 'decimal' },
      { key: 'value', label: 'report.col_amount', kind: 'decimal' },
      { key: 'moved_at', label: 'report.col_moved_at', kind: 'datetime' },
      { key: 'counted_on', label: 'report.col_counted_on', kind: 'date' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const { rows, more } = await this.stock.levelRows(
      tx,
      context.tenantId,
      await this.accounts.reachIds(tx, context.access),
      offset,
      limit,
    );
    const accounts = await this.accounts.forReport(
      tx,
      context.tenantId,
      rows.map((row) => row.accountId),
    );
    const items = new Map(
      (
        await this.catalogue.items(
          tx,
          context.tenantId,
          rows.map((row) => row.itemId),
        )
      ).map((item) => [item.id, item]),
    );
    const rates = await this.stock.ratesFor(
      tx,
      context.access,
      rows.map((row) => row.accountId),
    );
    const wanted = context.filters.accountType;
    const result: ReportRow[] = rows.flatMap((row) => {
      const account = accounts.get(row.accountId);
      if (wanted && account?.typeKey !== wanted) return [];
      const item = items.get(row.itemId);
      const rate = rates.get(row.accountId)?.get(row.itemId) ?? null;
      const value = row.onHand.startsWith('-') ? null : lineValue(row.onHand, rate);
      return [
        {
          account_code: account?.code ?? null,
          account_name: account?.name ?? null,
          account_type: account?.typeKey ?? null,
          item_code: item?.code ?? null,
          item_name: item?.name ?? null,
          unit: item?.baseUnit ?? null,
          on_hand: Number(row.onHand),
          unit_price: rate === null ? null : Number(rate),
          value: value === null ? null : Number(value),
          moved_at: row.movedAt?.toISOString() ?? null,
          counted_on: row.countedOn,
        },
      ];
    });
    return { rows: result, nextCursor: more ? String(offset + limit) : null };
  }
}

/**
 * The stock ledger (M18, BR-62, decision D130): every movement of the month at the accounts the
 * caller sees, oldest first, with what moved it.
 */
@Injectable()
export class StockLedgerReport extends ReportSource {
  readonly key = 'stock_ledger' as const;

  constructor(
    private readonly accounts: AccountsService,
    private readonly catalogue: CatalogueService,
    private readonly stock: StockService,
    private readonly people: People,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'date', label: 'report.col_date', kind: 'date' },
      { key: 'account_code', label: 'report.col_account_code', kind: 'text' },
      { key: 'account_name', label: 'report.col_account_name', kind: 'text' },
      { key: 'item_code', label: 'report.col_item_code', kind: 'text' },
      { key: 'item_name', label: 'report.col_item_name', kind: 'text' },
      { key: 'kind', label: 'report.col_kind', kind: 'text' },
      { key: 'quantity', label: 'report.col_quantity', kind: 'decimal' },
      { key: 'source', label: 'report.col_source', kind: 'text' },
      { key: 'reference', label: 'report.col_reference', kind: 'text' },
      { key: 'user_name', label: 'report.col_recorded_by', kind: 'text' },
      { key: 'recorded_at', label: 'report.col_recorded_at', kind: 'datetime' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const { rows, more } = await this.stock.ledgerRows(
      tx,
      context.tenantId,
      await this.accounts.reachIds(tx, context.access),
      context.from,
      context.to,
      offset,
      limit,
    );
    const accounts = await this.accounts.forReport(
      tx,
      context.tenantId,
      rows.map((row) => row.accountId),
    );
    const items = new Map(
      (
        await this.catalogue.items(
          tx,
          context.tenantId,
          rows.map((row) => row.itemId),
        )
      ).map((item) => [item.id, item]),
    );
    const people = await this.people.facts(
      tx,
      context.tenantId,
      rows.flatMap((row) => (row.createdBy ? [row.createdBy] : [])),
    );
    const wanted = context.filters.accountType;
    const result: ReportRow[] = rows.flatMap((row) => {
      const account = accounts.get(row.accountId);
      if (wanted && account?.typeKey !== wanted) return [];
      const item = items.get(row.itemId);
      return [
        {
          date: row.occurredOn,
          account_code: account?.code ?? null,
          account_name: account?.name ?? null,
          item_code: item?.code ?? null,
          item_name: item?.name ?? null,
          kind: context.text(`stock.kind_${row.kind}` as MessageKey),
          quantity: Number(row.units),
          source: context.text(`stock.source_${row.sourceType}` as MessageKey),
          reference: row.note,
          user_name: row.createdBy ? (people.get(row.createdBy)?.name ?? null) : null,
          recorded_at: row.createdAt.toISOString(),
        },
      ];
    });
    return { rows: result, nextCursor: more ? String(offset + limit) : null };
  }
}
