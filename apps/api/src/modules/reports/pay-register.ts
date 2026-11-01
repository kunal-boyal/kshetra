import { Injectable } from '@nestjs/common';
import type { PayslipFigures } from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { People } from '../iam/people';
import { StatutoryPayrollService } from '../payroll/statutory-payroll.service';
import {
  type ColumnSpec,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/** A payslip line's amount by key, nothing when it has none. */
const lineOf = (lines: PayslipFigures['deductions'], key: string) =>
  Number(lines.find((line) => line.key === key)?.amount ?? 0);

/**
 * The pay register (M14, BR-56 to BR-58, decision D128): one row a person in the month's pay run,
 * with earnings, each statutory deduction, net pay and the employer's contributions, for those
 * the report covers. Empty until the month's run is drafted; it says whether it is approved.
 */
@Injectable()
export class PayRegisterReport extends ReportSource {
  readonly key = 'pay_register' as const;

  constructor(
    private readonly people: People,
    private readonly payroll: StatutoryPayrollService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'user_code', label: 'report.col_user_code', kind: 'text' },
      { key: 'user_name', label: 'report.col_user_name', kind: 'text' },
      { key: 'run_status', label: 'report.col_run_status', kind: 'text' },
      { key: 'wages', label: 'report.col_pf_wages', kind: 'decimal' },
      { key: 'gross', label: 'report.col_gross_earned', kind: 'decimal' },
      { key: 'pf', label: 'report.col_pf_employee', kind: 'decimal' },
      { key: 'esi', label: 'report.col_esi_employee', kind: 'decimal' },
      { key: 'pt', label: 'report.col_pt', kind: 'decimal' },
      { key: 'lwf', label: 'report.col_lwf_employee', kind: 'decimal' },
      { key: 'tds', label: 'report.col_tds', kind: 'decimal' },
      { key: 'deductions', label: 'report.col_total_deductions', kind: 'decimal' },
      { key: 'net', label: 'report.col_net_pay', kind: 'decimal' },
      { key: 'employer_pf', label: 'report.col_pf_employer', kind: 'decimal' },
      { key: 'employer_esi', label: 'report.col_esi_employer', kind: 'decimal' },
      { key: 'employer_lwf', label: 'report.col_lwf_employer', kind: 'decimal' },
    ];
  }

  async page(tx: TenantTx, context: ReportContext): Promise<SourcePage> {
    const { run, rows } = await this.payroll.registerRows(
      tx,
      context.tenantId,
      context.people,
      context.from.slice(0, 7),
    );
    if (!run) return { rows: [], nextCursor: null };
    const people = await this.people.facts(
      tx,
      context.tenantId,
      rows.map((row) => row.userId),
    );
    const result: ReportRow[] = rows
      .map(({ userId, figures }) => ({
        user_code: people.get(userId)?.code ?? null,
        user_name: people.get(userId)?.name ?? null,
        run_status: context.text(
          run.status === 'approved' ? 'payroll.run_approved' : 'payroll.run_draft',
        ),
        wages: Number(figures.wages),
        gross: Number(figures.gross),
        pf: lineOf(figures.deductions, 'pf'),
        esi: lineOf(figures.deductions, 'esi'),
        pt: lineOf(figures.deductions, 'pt'),
        lwf: lineOf(figures.deductions, 'lwf'),
        tds: lineOf(figures.deductions, 'tds'),
        deductions: Number(figures.totalDeductions),
        net: Number(figures.net),
        employer_pf:
          lineOf(figures.employer, 'epf') +
          lineOf(figures.employer, 'eps') +
          lineOf(figures.employer, 'edli') +
          lineOf(figures.employer, 'pf_admin'),
        employer_esi: lineOf(figures.employer, 'esi'),
        employer_lwf: lineOf(figures.employer, 'lwf'),
      }))
      .sort((a, b) => String(a.user_code).localeCompare(String(b.user_code)));
    return { rows: result, nextCursor: null };
  }
}
