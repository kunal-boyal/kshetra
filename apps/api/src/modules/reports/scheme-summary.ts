import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';
import { OrdersService } from '../orders/orders.service';
import { monthMoments } from './report-helpers';
import {
  type ColumnSpec,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/**
 * Scheme summary (M18, BR-55, decision D127): each scheme that reached an order in the month, with
 * the orders and lines it reached, the discount it gave and the goods it gave free, for the orders
 * of the people the report covers.
 */
@Injectable()
export class SchemeSummaryReport extends ReportSource {
  readonly key = 'scheme_summary' as const;

  constructor(private readonly orders: OrdersService) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'scheme_key', label: 'report.col_scheme_key', kind: 'text' },
      { key: 'scheme', label: 'report.col_scheme', kind: 'text' },
      { key: 'kind', label: 'report.col_scheme_kind', kind: 'text' },
      { key: 'orders', label: 'report.col_orders', kind: 'number' },
      { key: 'lines', label: 'report.col_lines', kind: 'number' },
      { key: 'discount', label: 'report.col_scheme_discount', kind: 'decimal' },
      { key: 'free_units', label: 'report.col_free_units', kind: 'decimal' },
    ];
  }

  async page(tx: TenantTx, context: ReportContext): Promise<SourcePage> {
    const { from, to } = monthMoments(context);
    const rows = await this.orders.schemeTotals(tx, context.tenantId, context.people, from, to);
    const result: ReportRow[] = rows.map((row) => ({
      scheme_key: row.key,
      scheme: row.name?.[context.locale] ?? row.key,
      kind: context.text(`scheme.kind_${row.kind as 'percentage'}`),
      orders: row.orders,
      lines: row.lines,
      discount: Number(row.discount),
      free_units: Number(row.freeUnits),
    }));
    return { rows: result, nextCursor: null };
  }
}
