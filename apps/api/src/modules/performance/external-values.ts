import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type ImportProblem, newId } from '@thelamp/shared';
import { and, eq, sql } from 'drizzle-orm';
import { externalMetricValues } from '../../db/schema/metrics';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { People } from '../iam/people';
import { cellDate, cellText, isEmptyCell } from '../imports/reading';
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
import { MetricsService } from '../metrics/metrics.service';
import { MetricsEngine } from './metrics-engine';

/** A value as a three-place decimal: digits, a point, commas and ₹ allowed; never a float. */
function valueOf(text: string): string | null {
  const cleaned = text.replace(/[₹,\s]/g, '');
  return /^-?\d{1,15}(\.\d{1,3})?$/.test(cleaned) ? cleaned : null;
}

/** The last day of a month `YYYY-MM`, where a month's value sits (decision D94). */
export function lastDayOf(period: string): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

interface Planned {
  row: number;
  metricKey: string;
  userId: string | null;
  accountId: string | null;
  date: string;
  month: boolean;
  value: string;
}

/**
 * Values of external metrics (spec 5.7, B.6, decision D94): what an ERP or another system knows
 * and the field doesn't, such as secondary sales, loaded by file or the bulk API for a person or
 * an account, on a day or for a month. Loading a value again replaces it. An account's value counts
 * for the holder of its type's first slot on that day; each affected day is worked out again.
 */
@Injectable()
export class ExternalMetricsImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'external_metrics';
  readonly permission = 'metric.record';

  constructor(
    private readonly targets: ImportTargets,
    private readonly metrics: MetricsService,
    private readonly people: People,
    private readonly accounts: AccountsService,
    private readonly engine: MetricsEngine,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(): Promise<TargetField[]> {
    return [
      { key: 'metric', names: ['Metric key', 'Metric'], required: true },
      { key: 'date', names: ['Date'], required: false },
      { key: 'period', names: ['Period', 'Month'], required: false },
      { key: 'employee_code', names: ['Employee code', 'Emp code'], required: false },
      { key: 'account_code', names: ['Account code', 'Customer code'], required: false },
      { key: 'value', names: ['Value', 'Amount'], required: true },
    ];
  }

  /**
   * A person's value for a day and an account's for a month, on the tenant's first metric loaded
   * from outside, else its first metric (D111).
   */
  async example(tx: TenantTx, tenantId: string): Promise<ExampleRow[]> {
    const definitions = await this.metrics.definitions(tx, tenantId);
    const metric = (definitions.find((entry) => entry.source.type === 'external') ?? definitions[0])
      ?.key;
    return [
      {
        metric: metric ?? '',
        date: new Date().toISOString().slice(0, 10),
        employee_code: 'EMP-102',
        value: '12500',
      },
      {
        metric: metric ?? '',
        period: new Date().toISOString().slice(0, 7),
        account_code: 'A-101',
        value: '48000',
      },
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { access, emptyValues } = context;
    const tenantId = access.tenantId;
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const empty = (cell: ImportRow['cells'][string] | undefined) =>
      cell === undefined || isEmptyCell(cell, emptyValues);
    const external = new Set(
      (await this.metrics.definitions(tx, tenantId))
        .filter((metric) => metric.source.type === 'external')
        .map((metric) => metric.key),
    );
    const codes = new Map(
      (await this.people.everyone(tx, tenantId)).map((person) => [
        person.code.toLowerCase(),
        person.id,
      ]),
    );
    const accountIds = await this.accounts.seenByCode(
      tx,
      access,
      rows.map((row) => cellText(row.cells.account_code).trim()).filter(Boolean),
    );
    const seen = new Set<string>();
    const planned: Planned[] = [];
    for (const { row, cells } of rows) {
      const metricKey = cellText(cells.metric).trim();
      if (!metricKey) problem(row, 'metric', 'Fill in the metric key');
      else if (!external.has(metricKey)) problem(row, 'metric', 'No external metric has this key');

      const hasDate = !empty(cells.date);
      const hasPeriod = !empty(cells.period);
      let date: string | null = null;
      let month = false;
      if (hasDate === hasPeriod) {
        problem(row, 'date', 'Give either a date or a month, not both');
      } else if (hasDate) {
        date = cellDate(cells.date);
        if (!date) problem(row, 'date', 'Write the date as 2026-10-24 or 24-10-2026');
      } else {
        const period = cellText(cells.period).trim();
        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
          date = lastDayOf(period);
          month = true;
        } else {
          problem(row, 'period', 'Write the month as 2026-10');
        }
      }

      const employee = cellText(cells.employee_code).trim();
      const account = cellText(cells.account_code).trim();
      let userId: string | null = null;
      let accountId: string | null = null;
      if (Boolean(employee) === Boolean(account)) {
        problem(row, 'employee_code', 'Give either an employee code or an account code');
      } else if (employee) {
        userId = codes.get(employee.toLowerCase()) ?? null;
        if (!userId) problem(row, 'employee_code', 'No one has this employee code');
      } else {
        accountId = accountIds.get(account) ?? null;
        if (!accountId) problem(row, 'account_code', 'No account you see has this code');
      }

      const value = valueOf(cellText(cells.value));
      if (value === null) problem(row, 'value', 'Write a number such as 12500.5');

      if (!external.has(metricKey) || !date || (!userId && !accountId) || value === null) continue;
      const subject = `${metricKey}|${userId ?? ''}|${accountId ?? ''}|${date}`;
      if (seen.has(subject)) {
        problem(row, 'metric', 'This metric, subject and day are in the file already');
        continue;
      }
      seen.add(subject);
      planned.push({ row, metricKey, userId, accountId, date, month, value });
    }
    return { problems, planned };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    return checked((await this.plan(tx, rows, context)).problems);
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    const tenantId = context.access.tenantId;
    let created = 0;
    let updated = 0;
    // Days to work out again: those values now count in, and those they counted in before.
    const days = new Set<string>();
    for (const value of planned) {
      const creditedUserId =
        value.userId ??
        (await this.accounts.creditedOn(tx, tenantId, value.accountId!, value.date));
      const subject = and(
        eq(externalMetricValues.tenantId, tenantId),
        eq(externalMetricValues.metricKey, value.metricKey),
        value.userId
          ? eq(externalMetricValues.userId, value.userId)
          : sql`${externalMetricValues.userId} is null`,
        value.accountId
          ? eq(externalMetricValues.accountId, value.accountId)
          : sql`${externalMetricValues.accountId} is null`,
        eq(externalMetricValues.date, value.date),
      );
      const [before] = await tx
        .select({ creditedUserId: externalMetricValues.creditedUserId })
        .from(externalMetricValues)
        .where(subject)
        .for('update');
      if (before) {
        await tx
          .update(externalMetricValues)
          .set({
            value: value.value,
            month: value.month,
            creditedUserId,
            updatedAt: new Date(),
            updatedBy: context.access.userId,
          })
          .where(subject);
        updated += 1;
        if (before.creditedUserId) days.add(`${before.creditedUserId}|${value.date}`);
      } else {
        await tx.insert(externalMetricValues).values({
          tenantId,
          id: newId(),
          metricKey: value.metricKey,
          userId: value.userId,
          accountId: value.accountId,
          date: value.date,
          month: value.month,
          value: value.value,
          creditedUserId,
          updatedBy: context.access.userId,
        });
        created += 1;
      }
      if (creditedUserId) days.add(`${creditedUserId}|${value.date}`);
    }
    for (const day of days) {
      const [userId, date] = day.split('|') as [string, string];
      await this.engine.recompute(tx, tenantId, userId, date);
    }
    return { created, updated };
  }
}
