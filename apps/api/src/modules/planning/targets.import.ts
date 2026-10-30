import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type ImportProblem,
  periodKeyIssue,
  TargetPeriod,
  targetValueIssue,
  type TargetValues,
} from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { People } from '../iam/people';
import { cellText, cellYesNo, isEmptyCell } from '../imports/reading';
import {
  type ImportContext,
  ImportRefused,
  type ImportRow,
  type ImportTargetSource,
  ImportTargets,
  type TargetField,
  checked,
} from '../imports/targets';
import { MetricsService } from '../metrics/metrics.service';
import { TargetPeriods } from '../metrics/target-periods';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TargetsService } from './targets.service';

interface Planned {
  row: number;
  userId: string;
  period: string;
  values: TargetValues;
  lock: boolean;
}

/**
 * Target imports (spec Appendix B.4): employee code, period (a month such as 2026-10, or a
 * quarter or year such as FY2026-Q3 or FY2026, as the tenant counts, D108), one column per targetable metric,
 * and an optional lock. A blank cell leaves a value as it is. Rows for locked sets fail, unless
 * the tenant allows admin unlock and the importer holds that permission (BR-08); locking needs
 * the lock permission. People are found by code, within the importer's scope, never themselves.
 */
@Injectable()
export class TargetsImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'targets';
  readonly permission = 'target.edit';

  constructor(
    private readonly targets: ImportTargets,
    private readonly service: TargetsService,
    private readonly metrics: MetricsService,
    private readonly people: People,
    private readonly settings: TenantConfigService,
    private readonly periods: TargetPeriods,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(tx: TenantTx, tenantId: string): Promise<TargetField[]> {
    const metrics = await this.metrics.targetable(tx, tenantId);
    return [
      { key: 'code', names: ['Employee code', 'Code', 'Emp code'], required: true },
      { key: 'period', names: ['Period', 'Month'], required: true },
      { key: 'lock', names: ['Lock', 'Locked'], required: false },
      ...metrics.map((metric) => ({
        key: `metric.${metric.key}`,
        names: [metric.name.en.one, metric.name.hi.one, metric.key],
        required: false,
        label: { en: metric.name.en.one, hi: metric.name.hi.one },
      })),
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { access, emptyValues } = context;
    const tenantId = access.tenantId;
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const metrics = await this.metrics.targetable(tx, tenantId);
    const codes = new Map(
      (await this.people.everyone(tx, tenantId)).map((person) => [
        person.code.toLowerCase(),
        person.id,
      ]),
    );
    const { targetUnlockByAdmin } = await this.settings.settings(tx, tenantId);
    const overwriteLocked = targetUnlockByAdmin && access.permissions.has('target.unlock');
    const rules = await this.periods.rules(tx, tenantId);
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
      const period = cellText(cells.period).trim();
      if (!TargetPeriod.safeParse(period).success) {
        problem(row, 'period', 'Write the period as 2026-10, FY2026-Q3 or FY2026');
        continue;
      }
      const kindIssue = periodKeyIssue(period, rules.setting, rules.startMonth);
      if (kindIssue) {
        problem(row, 'period', kindIssue);
        continue;
      }
      if (seen.has(`${userId}|${period}`)) {
        problem(row, 'code', 'This person and period are in the file already');
        continue;
      }
      seen.add(`${userId}|${period}`);
      const refusal = await this.service.refusal(tx, access, userId);
      if (refusal === 'OWN') {
        problem(row, 'code', 'Your own targets are set by your manager');
        continue;
      }
      if (refusal) {
        problem(row, 'code', 'This person is outside your scope');
        continue;
      }
      const values: TargetValues = {};
      for (const metric of metrics) {
        const cell = cells[`metric.${metric.key}`];
        if (isEmptyCell(cell, emptyValues)) continue;
        const text = cellText(cell).trim();
        const issue = targetValueIssue(metric.unit, text);
        if (issue) problem(row, `metric.${metric.key}`, issue);
        else values[metric.key] = text;
      }
      const lockCell = cells.lock;
      const lock = !isEmptyCell(lockCell, emptyValues) && cellYesNo(lockCell) === true;
      if (lock && !access.permissions.has('target.lock')) {
        problem(row, 'lock', 'You can’t lock targets');
      }
      // Checking reads without locking: it runs read-only.
      const existing = await this.service.row(tx, tenantId, userId, period, false);
      if (existing?.status === 'locked' && !overwriteLocked) {
        problem(row, null, 'These targets are locked');
        continue;
      }
      if (lock && Object.keys(values).length === 0 && !existing) {
        problem(row, 'lock', 'There is nothing to lock');
      }
      planned.push({ row, userId, period, values, lock });
    }
    return { problems, planned };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    return checked((await this.plan(tx, rows, context)).problems);
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    const { access } = context;
    let created = 0;
    let updated = 0;
    for (const entry of planned) {
      const existing = await this.service.row(tx, access.tenantId, entry.userId, entry.period);
      if (Object.keys(entry.values).length > 0) {
        await this.service.write(tx, access, entry.userId, entry.period, entry.values, existing);
        if (existing) updated += 1;
        else created += 1;
      }
      if (entry.lock) {
        await this.service.lock(tx, access, { period: entry.period, userIds: [entry.userId] });
      }
    }
    return { created, updated };
  }
}
