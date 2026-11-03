import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';
import { CollectionsService } from '../finance/collections.service';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  ReportSource,
  type SourcePage,
} from './sources';

/**
 * Collections (M18, BR-63, decision D132): every collection the people covered took in the
 * month, with how it was paid, what the office decided and the books' receipt it was matched to.
 */
@Injectable()
export class CollectionsReport extends ReportSource {
  readonly key = 'collections' as const;

  constructor(private readonly collections: CollectionsService) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'number', label: 'report.col_collection', kind: 'text' },
      { key: 'collected_on', label: 'report.col_date', kind: 'date' },
      { key: 'user_code', label: 'report.col_user_code', kind: 'text' },
      { key: 'user_name', label: 'report.col_user_name', kind: 'text' },
      { key: 'account_code', label: 'report.col_account_code', kind: 'text' },
      { key: 'account_name', label: 'report.col_account_name', kind: 'text' },
      { key: 'mode', label: 'report.col_paid_by', kind: 'text' },
      { key: 'amount', label: 'report.col_amount', kind: 'decimal' },
      { key: 'reference', label: 'report.col_reference', kind: 'text' },
      { key: 'cheque_bank', label: 'report.col_cheque_bank', kind: 'text' },
      { key: 'cheque_date', label: 'report.col_cheque_date', kind: 'date' },
      { key: 'geofence', label: 'report.col_geofence', kind: 'text' },
      { key: 'status', label: 'report.col_day_status', kind: 'text' },
      { key: 'reason', label: 'report.col_decision_reason', kind: 'text' },
      { key: 'decided_by', label: 'report.col_decided_by', kind: 'text' },
      { key: 'decided_at', label: 'report.col_decided_at', kind: 'datetime' },
      { key: 'receipt', label: 'report.col_receipt_in_books', kind: 'text' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const { rows, more } = await this.collections.forReport(
      tx,
      context.access,
      context.people,
      context.from,
      context.to,
      offset,
      limit,
    );
    return {
      rows: rows.map((row) => ({
        number: row.number,
        collected_on: row.collectedOn,
        user_code: row.collector.code,
        user_name: row.collector.name,
        account_code: row.account.code,
        account_name: row.account.name,
        mode: context.text(`collections.mode_${row.mode}`),
        amount: Number(row.amount),
        reference: row.mode === 'cheque' ? row.chequeNumber : row.reference,
        cheque_bank: row.chequeBank,
        cheque_date: row.chequeDate,
        geofence:
          row.inGeofence === null
            ? null
            : context.text(row.inGeofence ? 'collections.at_account' : 'collections.away'),
        status: context.text(`collections.status_${row.status}`),
        reason: row.reason,
        decided_by: row.decidedBy?.name ?? null,
        decided_at: row.decidedAt,
        receipt: row.receipt?.number ?? null,
      })),
      nextCursor: more ? String(offset + limit) : null,
    };
  }
}
