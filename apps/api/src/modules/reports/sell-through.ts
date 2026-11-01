import { Injectable } from '@nestjs/common';
import type { MessageKey } from '@thelamp/i18n';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { People } from '../iam/people';
import { SellThroughService } from '../sell-through/sell-through.service';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/**
 * Sell-through by item (M18, BR-53, decision D124): each item of the month's latest stock
 * statement of every account the caller sees, with what it sold through and its value.
 */
@Injectable()
export class SellThroughReport extends ReportSource {
  readonly key = 'sell_through' as const;

  constructor(
    private readonly accounts: AccountsService,
    private readonly sellThrough: SellThroughService,
    private readonly people: People,
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
      { key: 'opening', label: 'report.col_opening', kind: 'decimal' },
      { key: 'received', label: 'report.col_received', kind: 'decimal' },
      { key: 'returned', label: 'report.col_returned', kind: 'decimal' },
      { key: 'closing', label: 'report.col_closing', kind: 'decimal' },
      { key: 'sold', label: 'report.col_sold', kind: 'decimal' },
      { key: 'unit_price', label: 'report.col_price', kind: 'decimal' },
      { key: 'value', label: 'report.col_amount', kind: 'decimal' },
      { key: 'flags', label: 'report.col_flags', kind: 'text' },
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
    const { rows, more } = await this.sellThrough.reportRows(
      tx,
      context.tenantId,
      await this.accounts.reachIds(tx, context.access),
      context.from.slice(0, 7),
      offset,
      limit,
    );
    const accounts = await this.accounts.forReport(
      tx,
      context.tenantId,
      rows.map((row) => row.accountId),
    );
    const people = await this.people.facts(
      tx,
      context.tenantId,
      rows.map((row) => row.recordedBy),
    );
    const wanted = context.filters.accountType;
    const number = (value: string | null) => (value === null ? null : Number(value));
    const result: ReportRow[] = rows.flatMap((row) => {
      const account = accounts.get(row.accountId);
      if (wanted && account?.typeKey !== wanted) return [];
      return [
        {
          account_code: account?.code ?? null,
          account_name: account?.name ?? null,
          account_type: account?.typeKey ?? null,
          item_code: row.itemCode,
          item_name: row.itemName,
          opening: Number(row.opening),
          received: Number(row.received),
          returned: Number(row.returned),
          closing: Number(row.closing),
          sold: Number(row.sold),
          unit_price: number(row.unitPrice),
          value: number(row.value),
          flags: row.flags
            .map((flag) => context.text(`sell_through.flag_${flag}` as MessageKey))
            .join(', '),
          user_name: people.get(row.recordedBy)?.name ?? null,
          recorded_at: row.recordedAt.toISOString(),
        },
      ];
    });
    return { rows: result, nextCursor: more ? String(offset + limit) : null };
  }
}
