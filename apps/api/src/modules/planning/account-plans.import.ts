import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type ImportProblem, Period, targetValueIssue, type TargetValues } from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { cellText, isEmptyCell } from '../imports/reading';
import {
  type ImportContext,
  ImportRefused,
  type ImportRow,
  type ImportTargetSource,
  ImportTargets,
  type TargetField,
  checked,
  type ExampleRow,
} from '../imports/targets';
import { exampleFigure } from '../imports/examples';
import { MetricsService } from '../metrics/metrics.service';
import { AccountPlansService } from './account-plans.service';

interface Planned {
  accountId: string;
  period: string;
  values: TargetValues;
}

/**
 * Account plan imports (spec Appendix B.6): account code, period and one column per targetable
 * metric; a blank cell leaves a value as it is. Accounts are found by code among those the
 * importer sees.
 */
@Injectable()
export class AccountPlansImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'account_plans';
  readonly permission = 'account_plan.manage';

  constructor(
    private readonly targets: ImportTargets,
    private readonly plans: AccountPlansService,
    private readonly accounts: AccountsService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(tx: TenantTx, tenantId: string): Promise<TargetField[]> {
    const metrics = await this.metrics.targetable(tx, tenantId);
    return [
      { key: 'account_code', names: ['Account code', 'Code', 'Customer code'], required: true },
      { key: 'period', names: ['Period', 'Month'], required: true },
      ...metrics.map((metric) => ({
        key: `metric.${metric.key}`,
        names: [metric.name.en.one, metric.name.hi.one, metric.key],
        required: false,
        label: { en: metric.name.en.one, hi: metric.name.hi.one },
      })),
    ];
  }

  /** Two accounts' plans for this month, on the first two targetable metrics (D111). */
  async example(tx: TenantTx, tenantId: string): Promise<ExampleRow[]> {
    const metrics = (await this.metrics.targetable(tx, tenantId)).slice(0, 2);
    const period = new Date().toISOString().slice(0, 7);
    const values = (second: boolean) =>
      Object.fromEntries(
        metrics.map((metric) => [`metric.${metric.key}`, exampleFigure(metric.unit, second)]),
      );
    return [
      { account_code: 'A-101', period, ...values(false) },
      { account_code: 'A-102', period, ...values(true) },
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { access, emptyValues } = context;
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const metrics = await this.metrics.targetable(tx, access.tenantId);
    const ids = await this.accounts.seenByCode(
      tx,
      access,
      rows.map((row) => cellText(row.cells.account_code).trim()).filter(Boolean),
    );
    const seen = new Set<string>();
    const planned: Planned[] = [];
    for (const { row, cells } of rows) {
      const code = cellText(cells.account_code).trim();
      const accountId = ids.get(code);
      if (!code) {
        problem(row, 'account_code', 'Fill in the account code');
        continue;
      }
      if (!accountId) {
        problem(row, 'account_code', 'No account you see has this code');
        continue;
      }
      const period = cellText(cells.period).trim();
      if (!Period.safeParse(period).success) {
        problem(row, 'period', 'Write the month as 2026-10');
        continue;
      }
      if (seen.has(`${accountId}|${period}`)) {
        problem(row, 'account_code', 'This account and month are in the file already');
        continue;
      }
      seen.add(`${accountId}|${period}`);
      const values: TargetValues = {};
      for (const metric of metrics) {
        const cell = cells[`metric.${metric.key}`];
        if (isEmptyCell(cell, emptyValues)) continue;
        const text = cellText(cell).trim();
        const issue = targetValueIssue(metric.unit, text);
        if (issue) problem(row, `metric.${metric.key}`, issue);
        else values[metric.key] = text;
      }
      planned.push({ accountId, period, values });
    }
    return { problems, planned };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    return checked((await this.plan(tx, rows, context)).problems);
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    let updated = 0;
    for (const entry of planned) {
      if (Object.keys(entry.values).length === 0) continue;
      await this.plans.write(tx, context.access, entry.accountId, entry.period, entry.values);
      updated += 1;
    }
    return { created: 0, updated };
  }
}
