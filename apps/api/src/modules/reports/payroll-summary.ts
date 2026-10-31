import { Injectable } from '@nestjs/common';
import { dayCounts } from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { People } from '../iam/people';
import { PayrollService } from '../payroll/payroll.service';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/**
 * The payroll summary (M14, decisions D14 and D117): one row a person for the month, with the
 * gross in force, the days by status, the paid and scheduled days, and the provisional pay
 * (BR-26). It is the attendance summary for a payroll provider: an estimate, not payroll.
 */
@Injectable()
export class PayrollSummaryReport extends ReportSource {
  readonly key = 'payroll_summary' as const;

  constructor(
    private readonly people: People,
    private readonly payroll: PayrollService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'user_code', label: 'report.col_user_code', kind: 'text' },
      { key: 'user_name', label: 'report.col_user_name', kind: 'text' },
      { key: 'designation', label: 'report.col_designation', kind: 'text' },
      { key: 'monthly_gross', label: 'report.col_monthly_gross', kind: 'decimal' },
      { key: 'scheduled_days', label: 'report.col_scheduled_days', kind: 'number' },
      { key: 'present', label: 'report.col_present_days', kind: 'number' },
      { key: 'half_days', label: 'report.col_half_days', kind: 'number' },
      { key: 'paid_leave', label: 'report.col_paid_leave_days', kind: 'number' },
      { key: 'unpaid_leave', label: 'report.col_unpaid_leave_days', kind: 'number' },
      { key: 'absent', label: 'report.col_absent_days', kind: 'number' },
      { key: 'holidays', label: 'report.col_holidays', kind: 'number' },
      { key: 'weekly_offs', label: 'report.col_weekly_offs', kind: 'number' },
      { key: 'paid_days', label: 'report.col_paid_days', kind: 'decimal' },
      { key: 'provisional_pay', label: 'report.col_provisional_pay', kind: 'decimal' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const everyone = await this.people.among(tx, context.tenantId, context.people, context.from);
    const shown = everyone.slice(offset, offset + limit);
    const period = context.from.slice(0, 7);
    const days = await this.payroll.days(
      tx,
      context.tenantId,
      shown.map((person) => person.id),
      period,
    );
    const months = await this.payroll.months(tx, context.tenantId, shown, period, days);
    const designations = new Map(shown.map((person) => [person.id, person.designation]));
    const rows: ReportRow[] = months.map((month) => {
      const counts = dayCounts(days.get(month.user.id) ?? []);
      return {
        user_code: month.user.code,
        user_name: month.user.name,
        designation: designations.get(month.user.id) ?? null,
        monthly_gross: month.monthlyGross === null ? null : Number(month.monthlyGross),
        scheduled_days: month.scheduled,
        present: counts.present,
        half_days: counts.half_day,
        paid_leave: counts.paid_leave,
        unpaid_leave: counts.unpaid_leave,
        absent: counts.absent,
        holidays: counts.holiday,
        weekly_offs: counts.weekly_off,
        paid_days: month.paid,
        provisional_pay: month.amount === null ? null : Number(month.amount),
      };
    });
    return {
      rows,
      nextCursor: offset + limit < everyone.length ? String(offset + limit) : null,
    };
  }
}
