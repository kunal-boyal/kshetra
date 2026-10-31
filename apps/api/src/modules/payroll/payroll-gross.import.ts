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
import { PayrollService } from './payroll.service';

interface Planned {
  userId: string;
  monthlyGross: string;
  from: string;
}

/**
 * Payroll gross imports (Appendix B.7, decision D117): employee code, monthly gross, and the month
 * it applies from, this month when blank. A month before a person's latest change is refused, so
 * months already priced keep their gross.
 */
@Injectable()
export class PayrollGrossImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'payroll_gross';
  readonly permission = 'payroll.manage';

  constructor(
    private readonly targets: ImportTargets,
    private readonly people: People,
    private readonly scopes: Scopes,
    private readonly payroll: PayrollService,
    private readonly config: TenantConfigService,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(): Promise<TargetField[]> {
    return [
      { key: 'code', names: ['Employee code', 'Code', 'Emp code'], required: true },
      { key: 'gross', names: ['Monthly gross', 'Gross'], required: true },
      { key: 'from', names: ['From month', 'From'], required: false },
    ];
  }

  /** Two people's gross from this month (D111). */
  async example(tx: TenantTx, tenantId: string): Promise<ExampleRow[]> {
    const from = todayIn((await this.config.settings(tx, tenantId)).timezone).slice(0, 7);
    return [
      { code: 'EMP-101', gross: '28000.00', from },
      { code: 'EMP-102', gross: '32500.00', from },
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
      const gross = cellText(cells.gross).trim().replaceAll(',', '');
      if (!Money.safeParse(gross).success) {
        problem(row, 'gross', 'Write the monthly gross as an amount, such as 28000 or 28000.50');
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
      if (seen.has(`${userId}|${from}`)) {
        problem(row, 'code', 'This person and month are in the file already');
        continue;
      }
      seen.add(`${userId}|${from}`);
      const issue = await this.payroll.fromIssue(tx, tenantId, userId, from);
      if (issue) {
        problem(row, 'from', issue);
        continue;
      }
      planned.push({ userId, monthlyGross: gross, from });
    }
    return { problems, planned };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    return checked((await this.plan(tx, rows, context)).problems);
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    // Earliest first, so a person's two months in one file both pass the latest-change check.
    const ordered = [...planned].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    let created = 0;
    let updated = 0;
    for (const entry of ordered) {
      const before = await this.payroll.changesOf(tx, context.access.tenantId, entry.userId);
      await this.payroll.write(tx, context.access, entry.userId, entry.monthlyGross, entry.from, [
        'from',
      ]);
      if (before.changes.some((change) => change.from === entry.from)) updated += 1;
      else created += 1;
    }
    return { created, updated };
  }
}
