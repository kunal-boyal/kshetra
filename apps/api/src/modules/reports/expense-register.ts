import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';
import { ExpenseClaimsService } from '../expenses/expense-claims.service';
import { ExpensePoliciesService } from '../expenses/expense-policies.service';
import { People } from '../iam/people';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/**
 * The expense register (M12, M18): every claim for a day in the month by the people the report
 * covers, with its policy, amount after caps, receipts and state. Exported, it is the payroll
 * file of approved claims; filtering by state is the reader's.
 */
@Injectable()
export class ExpenseRegisterReport extends ReportSource {
  readonly key = 'expense_register' as const;

  constructor(
    private readonly people: People,
    private readonly claims: ExpenseClaimsService,
    private readonly policies: ExpensePoliciesService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'date', label: 'report.col_date', kind: 'date' },
      { key: 'user_code', label: 'report.col_user_code', kind: 'text' },
      { key: 'user_name', label: 'report.col_user_name', kind: 'text' },
      { key: 'policy', label: 'report.col_policy', kind: 'text' },
      { key: 'description', label: 'report.col_description', kind: 'text' },
      { key: 'quantity', label: 'report.col_quantity', kind: 'decimal' },
      { key: 'rate', label: 'report.col_rate', kind: 'decimal' },
      { key: 'calculated', label: 'report.col_calculated', kind: 'decimal' },
      { key: 'amount', label: 'report.col_amount', kind: 'decimal' },
      { key: 'receipts', label: 'report.col_receipts', kind: 'number' },
      {
        key: 'status',
        label: 'report.col_status',
        kind: 'status',
        tones: {
          'approval.status_pending': 'pending',
          'approval.status_approved': 'success',
          'approval.status_rejected': 'danger',
          'approval.status_cancelled': 'neutral',
          'report.state_paid': 'success',
        },
      },
      { key: 'paid_at', label: 'report.col_paid_at', kind: 'datetime' },
      { key: 'reference', label: 'report.col_reference', kind: 'text' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const rows = await this.claims.register(
      tx,
      context.tenantId,
      context.people,
      context.from,
      context.to,
      offset,
      limit,
    );
    const shown = rows.slice(0, limit);
    const people = await this.people.facts(
      tx,
      context.tenantId,
      shown.map((row) => row.userId),
    );
    const names = new Map(
      (await this.policies.list(tx, context.tenantId)).map((policy) => [
        policy.key,
        policy.name[context.locale],
      ]),
    );
    const result: ReportRow[] = shown.map((row) => ({
      date: row.expenseDate,
      user_code: people.get(row.userId)?.code ?? null,
      user_name: people.get(row.userId)?.name ?? null,
      policy: names.get(row.policyKey) ?? row.policyKey,
      description: row.description,
      quantity: row.quantity === null ? null : Number(row.quantity),
      rate: row.rate === null ? null : Number(row.rate),
      calculated: Number(row.calculated),
      amount: Number(row.amount),
      receipts: row.receipts,
      status: context.text(
        row.state === 'paid'
          ? 'report.state_paid'
          : `approval.status_${row.state as 'pending' | 'approved' | 'rejected' | 'cancelled'}`,
      ),
      paid_at: row.paidAt?.toISOString() ?? null,
      reference: row.paymentReference,
    }));
    return {
      rows: result,
      nextCursor: rows.length > limit ? String(offset + limit) : null,
    };
  }
}
