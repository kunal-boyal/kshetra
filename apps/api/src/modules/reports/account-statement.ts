import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { FinanceService } from '../finance/finance.service';
import { offsetPage } from './report-helpers';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/**
 * The account statement (M11, M18, decision D79 deferred it here): every statement entry of the
 * month for the accounts the caller sees, by account and date, each with the account's running
 * balance over everything before it (BR-21).
 */
@Injectable()
export class AccountStatementReport extends ReportSource {
  readonly key = 'account_statement' as const;

  constructor(
    private readonly accounts: AccountsService,
    private readonly finance: FinanceService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'account_code', label: 'report.col_account_code', kind: 'text' },
      { key: 'account_name', label: 'report.col_account_name', kind: 'text' },
      { key: 'date', label: 'report.col_date', kind: 'date' },
      { key: 'reference', label: 'report.col_reference', kind: 'text' },
      { key: 'description', label: 'report.col_description', kind: 'text' },
      { key: 'debit', label: 'report.col_debit', kind: 'decimal' },
      { key: 'credit', label: 'report.col_credit', kind: 'decimal' },
      { key: 'balance', label: 'report.col_balance', kind: 'decimal' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const rows = await this.finance.statementRows(
      tx,
      context.tenantId,
      await this.accounts.reachIds(tx, context.access),
      context.from,
      context.to,
      offset,
      limit,
    );
    const { shown, nextCursor } = offsetPage(rows, offset, limit);
    const accounts = await this.accounts.forReport(
      tx,
      context.tenantId,
      shown.map((row) => row.account_id),
    );
    const wanted = context.filters.accountType;
    const result: ReportRow[] = shown.flatMap((row) => {
      const account = accounts.get(row.account_id);
      if (wanted && account?.typeKey !== wanted) return [];
      return [
        {
          account_code: account?.code ?? null,
          account_name: account?.name ?? null,
          date: row.date,
          reference: row.reference,
          description: row.description,
          debit: Number(row.debit),
          credit: Number(row.credit),
          balance: Number(row.balance),
        },
      ];
    });
    return { rows: result, nextCursor };
  }
}
