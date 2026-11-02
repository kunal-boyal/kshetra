import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type ImportProblem, Money, Period, todayIn } from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { cellDate, cellText, isEmptyCell } from '../imports/reading';
import {
  checked,
  type ExampleRow,
  type ImportContext,
  ImportRefused,
  type ImportRow,
  type ImportTargetSource,
  ImportTargets,
  type TargetField,
} from '../imports/targets';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { StatutoryPayrollService } from './statutory-payroll.service';

const AMOUNTS = ['basic', 'da', 'hra', 'conveyance', 'special'] as const;
type AmountKey = (typeof AMOUNTS)[number];

interface Planned {
  userId: string;
  from: string;
  amounts: Record<AmountKey, string>;
}

/**
 * Salary structure imports (Appendix B.7, decision D128): employee code, the month it applies
 * from (this month when blank), and the monthly basic, DA, HRA, conveyance and special allowance.
 * A month before a person's latest change, or one already paid, is refused.
 */
@Injectable()
export class SalaryStructuresImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'salary_structures';
  readonly permission = 'salary.manage';

  constructor(
    private readonly targets: ImportTargets,
    private readonly people: People,
    private readonly scopes: Scopes,
    private readonly payroll: StatutoryPayrollService,
    private readonly config: TenantConfigService,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(): Promise<TargetField[]> {
    return [
      { key: 'code', names: ['Employee code', 'Code', 'Emp code'], required: true },
      { key: 'from', names: ['From month', 'From'], required: false },
      { key: 'basic', names: ['Basic'], required: true },
      { key: 'da', names: ['DA', 'Dearness allowance'], required: false },
      { key: 'hra', names: ['HRA', 'House rent allowance'], required: false },
      { key: 'conveyance', names: ['Conveyance'], required: false },
      { key: 'special', names: ['Special allowance', 'Special'], required: false },
    ];
  }

  /** Two people's structures from this month (D111). */
  async example(tx: TenantTx, tenantId: string): Promise<ExampleRow[]> {
    const from = todayIn((await this.config.settings(tx, tenantId)).timezone).slice(0, 7);
    return [
      {
        code: 'EMP-101',
        from,
        basic: '15000.00',
        da: '0',
        hra: '6000.00',
        conveyance: '1600.00',
        special: '5400.00',
      },
      {
        code: 'EMP-102',
        from,
        basic: '18000.00',
        da: '0',
        hra: '7200.00',
        conveyance: '1600.00',
        special: '5700.00',
      },
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { access, emptyValues } = context;
    const tenantId = access.tenantId;
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const codes = new Map(
      (await this.people.everyone(tx, tenantId)).map((person) => [
        person.code.toLowerCase(),
        person.id,
      ]),
    );
    const thisMonth = todayIn((await this.config.settings(tx, tenantId)).timezone).slice(0, 7);
    const seen = new Set<string>();
    const planned: Planned[] = [];
    for (const { row, cells } of rows) {
      const code = cellText(cells.code).trim();
      const userId = codes.get(code.toLowerCase());
      if (!code) {
        problem(row, 'code', 'Fill in the employee code');
        continue;
      }
      if (!userId) {
        problem(row, 'code', 'No one has this employee code');
        continue;
      }
      if (!(await this.scopes.reaches(tx, access, userId))) {
        problem(row, 'code', 'This person is outside your scope');
        continue;
      }
      let from = thisMonth;
      if (!isEmptyCell(cells.from, emptyValues)) {
        const text = cellText(cells.from).trim();
        const month = Period.safeParse(text).success ? text : cellDate(cells.from)?.slice(0, 7);
        if (!month) {
          problem(row, 'from', 'Write the month as 2026-10');
          continue;
        }
        from = month;
      }
      const amounts = {} as Record<AmountKey, string>;
      let wrong = false;
      for (const key of AMOUNTS) {
        const empty = isEmptyCell(cells[key], emptyValues);
        const text = empty ? '0' : cellText(cells[key]).trim().replaceAll(',', '');
        if ((key === 'basic' && empty) || !Money.safeParse(text).success) {
          problem(row, key, 'Write a monthly amount, such as 15000 or 15000.50');
          wrong = true;
        }
        amounts[key] = text;
      }
      if (wrong) continue;
      if (seen.has(`${userId}|${from}`)) {
        problem(row, 'code', 'This person and month are in the file already');
        continue;
      }
      seen.add(`${userId}|${from}`);
      planned.push({ userId, from, amounts });
    }
    return { problems, planned };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    return checked((await this.plan(tx, rows, context)).problems);
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    const ordered = [...planned].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    let created = 0;
    let updated = 0;
    for (const entry of ordered) {
      const before = await this.payroll.structures(tx, context.access, entry.userId);
      try {
        await this.payroll.writeStructure(
          tx,
          context.access,
          entry.userId,
          { from: entry.from, ...entry.amounts, others: [] },
          ['from'],
        );
      } catch (error) {
        // A month before the latest change, or one already paid, refuses the whole file.
        const issue =
          (error as { details?: { issue: string }[] }).details?.[0]?.issue ??
          'This month can’t change';
        throw new ImportRefused([{ row: 0, field: 'from', issue }]);
      }
      if (before.changes.some((change) => change.from === entry.from)) updated += 1;
      else created += 1;
    }
    return { created, updated };
  }
}
