import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  AppError,
  type ForecastLineBody,
  forecastMonths,
  type ImportProblem,
  newId,
  StockQuantity,
  todayIn,
} from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import { cellText, isEmptyCell } from '../imports/reading';
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
import { ForecastsService } from './forecasts.service';

/** A month as files write it: 2026-12, 12-2026 or 12/2026. */
function monthOf(text: string): string | null {
  const value = text.trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  const flipped = /^(0?[1-9]|1[0-2])[-/](\d{4})$/.exec(value);
  return flipped ? `${flipped[2]}-${flipped[1]!.padStart(2, '0')}` : null;
}

interface Group {
  accountId: string;
  period: string;
  rows: number[];
  lines: ForecastLineBody[];
}

/**
 * Forecast imports (BR-54, decision D126): quantities by account, month and item, for the months
 * still open; each account's month in a file is one new version, recorded for whoever holds the
 * account's first slot, else the person importing. The bulk API serves the same target.
 */
@Injectable()
export class ForecastsImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'forecasts';
  readonly permission = 'forecast.record';

  constructor(
    private readonly targets: ImportTargets,
    private readonly forecasts: ForecastsService,
    private readonly accounts: AccountsService,
    private readonly catalogue: CatalogueService,
    private readonly config: TenantConfigService,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(): Promise<TargetField[]> {
    return [
      { key: 'account_code', names: ['Account code', 'Code', 'Customer code'], required: true },
      { key: 'month', names: ['Month', 'Period'], required: true },
      { key: 'item_code', names: ['Item code', 'SKU', 'Product code'], required: true },
      { key: 'quantity', names: ['Quantity', 'Forecast', 'Qty'], required: true },
    ];
  }

  /** Next month's forecast of two items at one account (D111). */
  async example(tx: TenantTx, tenantId: string): Promise<ExampleRow[]> {
    const { timezone } = await this.config.settings(tx, tenantId);
    const [month] = forecastMonths(todayIn(timezone));
    const [first, second] = (await this.catalogue.items(tx, tenantId)).filter(
      (item) => item.active,
    );
    return [
      { account_code: 'A-101', month: month!, item_code: first?.code ?? 'ITEM-1', quantity: '120' },
      { account_code: 'A-101', month: month!, item_code: second?.code ?? 'ITEM-2', quantity: '45' },
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { access, emptyValues } = context;
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const ids = await this.accounts.seenByCode(
      tx,
      access,
      rows.map((row) => cellText(row.cells.account_code).trim()).filter(Boolean),
    );
    const items = new Map(
      (await this.catalogue.items(tx, access.tenantId))
        .filter((item) => item.active)
        .map((item) => [item.code, item.id]),
    );
    const { timezone } = await this.config.settings(tx, access.tenantId);
    const open = new Set(forecastMonths(todayIn(timezone)));
    const groups = new Map<string, Group>();
    for (const { row, cells } of rows) {
      const code = cellText(cells.account_code).trim();
      const accountId = ids.get(code);
      if (!code) problem(row, 'account_code', 'Fill in the account code');
      else if (!accountId) problem(row, 'account_code', 'No account you see has this code');
      const period = monthOf(cellText(cells.month));
      if (!period) problem(row, 'month', 'Write the month as 2026-12');
      else if (!open.has(period)) problem(row, 'month', 'Forecast only the months still open');
      const itemId = items.get(cellText(cells.item_code).trim());
      if (!itemId) problem(row, 'item_code', 'There is no item with this code');
      const raw = cells.quantity;
      const text =
        raw === undefined || isEmptyCell(raw, emptyValues)
          ? ''
          : cellText(raw).replace(/,/g, '').trim();
      if (!StockQuantity.safeParse(text).success) {
        problem(row, 'quantity', 'Write a quantity such as 12 or 0.5, 0 to take it out');
        continue;
      }
      if (!accountId || !period || !itemId || !open.has(period)) continue;
      const key = `${accountId}:${period}`;
      const group = groups.get(key) ?? { accountId, period, rows: [], lines: [] };
      if (group.lines.some((line) => line.itemId === itemId)) {
        problem(row, 'item_code', 'This item is in this month twice');
        continue;
      }
      group.rows.push(row);
      group.lines.push({ itemId, quantity: text });
      groups.set(key, group);
    }
    return { problems, groups: [...groups.values()], timezone };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, groups } = await this.plan(tx, rows, context);
    return checked(
      problems,
      groups.map(() => ({ existing: false })),
    );
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, groups, timezone } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    const { access } = context;
    const person = access.support || access.apiClient ? null : access.userId;
    const today = todayIn(timezone);
    for (const group of groups) {
      const recordedBy =
        (await this.accounts.creditedOn(tx, access.tenantId, group.accountId, today)) ?? person;
      if (!recordedBy) {
        throw new ImportRefused([
          { row: group.rows[0]!, field: 'account_code', issue: 'Nobody holds this account' },
        ]);
      }
      try {
        await this.forecasts.record(tx, access, {
          id: newId(),
          accountId: group.accountId,
          period: group.period,
          lines: group.lines,
          recordedBy,
        });
      } catch (error) {
        if (!(error instanceof AppError) || error.status >= 500) throw error;
        throw new ImportRefused([{ row: group.rows[0]!, field: null, issue: error.message }]);
      }
    }
    return { created: groups.length, updated: 0 };
  }
}
