import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { People } from '../iam/people';
import { OrdersService } from '../orders/orders.service';
import { monthMoments, offsetPage } from './report-helpers';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/**
 * The orders register (M18): one row per line of every order placed in the month, with the item
 * as it was ordered, its full pricing (BR-10 to BR-12), the line's decision and the order's status.
 */
@Injectable()
export class OrdersRegisterReport extends ReportSource {
  readonly key = 'orders_register' as const;

  constructor(
    private readonly people: People,
    private readonly orders: OrdersService,
    private readonly accounts: AccountsService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'placed_at', label: 'report.col_placed_at', kind: 'datetime' },
      { key: 'order', label: 'report.col_order', kind: 'text' },
      { key: 'line', label: 'report.col_line', kind: 'number' },
      { key: 'user_code', label: 'report.col_user_code', kind: 'text' },
      { key: 'user_name', label: 'report.col_user_name', kind: 'text' },
      { key: 'account_code', label: 'report.col_account_code', kind: 'text' },
      { key: 'account_name', label: 'report.col_account_name', kind: 'text' },
      { key: 'item_code', label: 'report.col_item_code', kind: 'text' },
      { key: 'item_name', label: 'report.col_item_name', kind: 'text' },
      { key: 'unit', label: 'report.col_unit', kind: 'text' },
      { key: 'quantity', label: 'report.col_quantity', kind: 'decimal' },
      { key: 'price', label: 'report.col_price', kind: 'decimal' },
      { key: 'discount', label: 'report.col_discount', kind: 'decimal' },
      { key: 'rate', label: 'report.col_rate', kind: 'decimal' },
      { key: 'tax_rate', label: 'report.col_tax_rate', kind: 'decimal' },
      { key: 'taxable', label: 'report.col_taxable', kind: 'decimal' },
      { key: 'tax', label: 'report.col_tax', kind: 'decimal' },
      { key: 'line_total', label: 'report.col_line_total', kind: 'decimal' },
      { key: 'line_decision', label: 'report.col_line_decision', kind: 'text' },
      { key: 'decision_reason', label: 'report.col_decision_reason', kind: 'text' },
      {
        key: 'order_status',
        label: 'report.col_order_status',
        kind: 'status',
        tones: {
          'orders.status_submitted': 'pending',
          'orders.status_accepted': 'success',
          'orders.status_partially_accepted': 'waiting',
          'orders.status_rejected': 'danger',
          'orders.status_fulfilled': 'success',
          'orders.status_partially_fulfilled': 'waiting',
          'orders.status_cancelled': 'neutral',
        },
      },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const { from, to } = monthMoments(context);
    const rows = await this.orders.registerRows(
      tx,
      context.tenantId,
      context.people,
      from,
      to,
      offset,
      limit,
    );
    const { shown, nextCursor } = offsetPage(rows, offset, limit);
    const people = await this.people.facts(
      tx,
      context.tenantId,
      shown.map((row) => row.userId),
    );
    const accounts = await this.accounts.forReport(
      tx,
      context.tenantId,
      shown.map((row) => row.accountId),
    );
    const wanted = context.filters.accountType;
    const result: ReportRow[] = shown.flatMap((row) => {
      const account = accounts.get(row.accountId);
      if (wanted && account?.typeKey !== wanted) return [];
      const item = row.snapshot as { code: string; name: string };
      return [
        {
          placed_at: row.placedAt.toISOString(),
          order: row.orderId,
          line: row.position,
          user_code: people.get(row.userId)?.code ?? null,
          user_name: people.get(row.userId)?.name ?? null,
          account_code: account?.code ?? null,
          account_name: account?.name ?? null,
          item_code: item.code,
          item_name: item.name,
          unit: row.unitKey,
          quantity: Number(row.quantity),
          price: Number(row.price),
          discount: Number(row.discount),
          rate: Number(row.rate),
          tax_rate: Number(row.taxRate),
          taxable: Number(row.taxable),
          tax: Number(row.tax),
          line_total: Number(row.total),
          line_decision: context.text(`orders.line_${row.decision}`),
          decision_reason: row.decisionReason,
          order_status: context.text(`orders.status_${row.orderStatus}`),
        },
      ];
    });
    return { rows: result, nextCursor };
  }
}
