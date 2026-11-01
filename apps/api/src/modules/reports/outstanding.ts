import { Injectable } from '@nestjs/common';
import { todayIn } from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { FinanceService } from '../finance/finance.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/** A bucket's heading: "0–30 days", "Over 180 days". */
function bucketLabel(bucket: { fromDays: number; toDays: number | null }) {
  return bucket.toDays === null
    ? { en: `Over ${bucket.fromDays - 1} days`, hi: `${bucket.fromDays - 1} दिन से ज़्यादा` }
    : {
        en: `${bucket.fromDays}–${bucket.toDays} days`,
        hi: `${bucket.fromDays}–${bucket.toDays} दिन`,
      };
}

/**
 * Outstanding by account (M11, M18, decisions D86 and D121): each account the caller sees that
 * has invoices or balance snapshots, as of the month's last day or today in the month under way.
 * Accounts with invoices show what those leave open, aged by days past due (BR-51); the rest show
 * their latest snapshot, marked by the source column.
 */
@Injectable()
export class OutstandingReport extends ReportSource {
  readonly key = 'outstanding' as const;

  constructor(
    private readonly accounts: AccountsService,
    private readonly finance: FinanceService,
    private readonly config: TenantConfigService,
  ) {
    super();
  }

  async columns(tx: TenantTx, context: ReportContext): Promise<ColumnSpec[]> {
    const { ageingBuckets } = await this.config.settings(tx, context.tenantId);
    return [
      { key: 'account_code', label: 'report.col_account_code', kind: 'text' },
      { key: 'account_name', label: 'report.col_account_name', kind: 'text' },
      { key: 'account_type', label: 'report.col_account_type', kind: 'text' },
      { key: 'source', label: 'report.col_figures_from', kind: 'text' },
      { key: 'as_of', label: 'report.col_as_of', kind: 'date' },
      { key: 'credit_limit', label: 'report.col_credit_limit', kind: 'decimal' },
      { key: 'outstanding', label: 'report.col_outstanding', kind: 'decimal' },
      { key: 'not_due', label: 'report.col_not_due', kind: 'decimal' },
      ...ageingBuckets.map((bucket): ColumnSpec => ({
        key: `ageing_${bucket.key}`,
        label: bucketLabel(bucket),
        kind: 'decimal',
      })),
      { key: 'oldest_due', label: 'report.col_oldest_due', kind: 'date' },
      { key: 'last_receipt_date', label: 'report.col_last_receipt_date', kind: 'date' },
      { key: 'last_receipt_amount', label: 'report.col_last_receipt_amount', kind: 'decimal' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const today = todayIn(context.timezone);
    const asOf = context.to < today ? context.to : today;
    const { ageingBuckets } = await this.config.settings(tx, context.tenantId);
    const { rows, more } = await this.finance.outstandingRows(
      tx,
      context.tenantId,
      await this.accounts.reachIds(tx, context.access),
      asOf,
      offset,
      limit,
    );
    const accounts = await this.accounts.forReport(
      tx,
      context.tenantId,
      rows.map((row) => row.accountId),
    );
    const wanted = context.filters.accountType;
    const number = (value: string | null | undefined) =>
      value === null || value === undefined ? null : Number(value);
    const result: ReportRow[] = rows.flatMap((row) => {
      const account = accounts.get(row.accountId);
      if (wanted && account?.typeKey !== wanted) return [];
      const figures = row.receivables;
      const snapshot = row.snapshot;
      const ageing = figures?.ageing ?? snapshot?.ageing ?? {};
      return [
        {
          account_code: account?.code ?? null,
          account_name: account?.name ?? null,
          account_type: account?.typeKey ?? null,
          source: context.text(figures ? 'report.figures_invoices' : 'report.figures_snapshot'),
          as_of: figures ? asOf : (snapshot?.asOf ?? null),
          credit_limit: number(snapshot?.creditLimit),
          outstanding: number(figures?.outstanding ?? snapshot?.outstanding),
          not_due: number(figures?.notDue),
          ...Object.fromEntries(
            ageingBuckets.map((bucket) => [`ageing_${bucket.key}`, number(ageing[bucket.key])]),
          ),
          oldest_due: figures?.oldestDue ?? null,
          last_receipt_date: row.lastReceipt?.date ?? null,
          last_receipt_amount: number(row.lastReceipt?.amount),
        },
      ];
    });
    return { rows: result, nextCursor: more ? String(offset + limit) : null };
  }
}
