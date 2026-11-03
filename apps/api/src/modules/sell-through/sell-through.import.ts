import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  AppError,
  creditedDate,
  type ImportProblem,
  type ImportTarget,
  newId,
  type SellThroughLineBody,
  statementOpen,
  StockQuantity,
  todayIn,
} from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { AccountTypesService } from '../accounts/account-types.service';
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
import { SellThroughService } from './sell-through.service';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A month as files write it: 2026-10, 10-2026 or 10/2026. */
function monthOf(text: string): string | null {
  const value = text.trim();
  if (MONTH.test(value)) return value;
  const flipped = /^(0?[1-9]|1[0-2])[-/](\d{4})$/.exec(value);
  return flipped ? `${flipped[2]}-${flipped[1]!.padStart(2, '0')}` : null;
}

interface Group {
  accountId: string;
  period: string;
  rows: number[];
  lines: SellThroughLineBody[];
}

/**
 * Sell-through imports (BR-53, decision D124): rows of item stock by account and month; each
 * account's month in a file is one new version of its statement, counted for whoever holds the
 * account's first slot on the day it counts on, else the person importing. The bulk API serves the
 * same target.
 */
@Injectable()
export class SellThroughImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'sell_through';
  readonly permission = 'sell_through.record';

  constructor(
    private readonly targets: ImportTargets,
    private readonly sellThrough: SellThroughService,
    private readonly accounts: AccountsService,
    private readonly types: AccountTypesService,
    private readonly catalogue: CatalogueService,
    private readonly config: TenantConfigService,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  /** Only while an active type of account gives statements (D139). */
  async offered(tx: TenantTx, tenantId: string): Promise<ImportTarget[]> {
    const types = await this.types.list(tx, tenantId);
    return types.some((type) => type.active && type.definition.sellThrough) ? ['sell_through'] : [];
  }

  async fields(): Promise<TargetField[]> {
    return [
      { key: 'account_code', names: ['Account code', 'Code', 'Customer code'], required: true },
      { key: 'month', names: ['Month', 'Period'], required: true },
      { key: 'item_code', names: ['Item code', 'SKU', 'Product code'], required: true },
      { key: 'opening', names: ['Opening', 'Opening stock'], required: false },
      { key: 'received', names: ['Received', 'Receipts', 'Purchases'], required: true },
      { key: 'returned', names: ['Returned', 'Returns'], required: false },
      { key: 'closing', names: ['Closing', 'Closing stock'], required: true },
    ];
  }

  /** One account's month, two items, the second carrying its opening forward (D111). */
  async example(tx: TenantTx, tenantId: string): Promise<ExampleRow[]> {
    const { timezone } = await this.config.settings(tx, tenantId);
    const month = todayIn(timezone).slice(0, 7);
    const [first, second] = (await this.catalogue.items(tx, tenantId)).filter(
      (item) => item.active,
    );
    return [
      {
        account_code: 'A-101',
        month,
        item_code: first?.code ?? 'ITEM-1',
        opening: '40',
        received: '100',
        returned: '5',
        closing: '60',
      },
      {
        account_code: 'A-101',
        month,
        item_code: second?.code ?? 'ITEM-2',
        received: '24',
        closing: '10',
      },
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
    const today = todayIn(timezone);
    const reporting = new Set<string>();
    const groups = new Map<string, Group>();
    for (const { row, cells } of rows) {
      const code = cellText(cells.account_code).trim();
      const accountId = ids.get(code);
      if (!code) problem(row, 'account_code', 'Fill in the account code');
      else if (!accountId) problem(row, 'account_code', 'No account you see has this code');
      const period = monthOf(cellText(cells.month));
      if (!period) problem(row, 'month', 'Write the month as 2026-10');
      else if (!statementOpen(period, today)) {
        problem(row, 'month', 'That month is closed, or hasn’t begun');
      }
      const itemId = items.get(cellText(cells.item_code).trim());
      if (!itemId) problem(row, 'item_code', 'There is no item with this code');
      const quantity = (key: string, required: boolean) => {
        const cell = cells[key];
        if (cell === undefined || isEmptyCell(cell, emptyValues)) {
          if (required) problem(row, key, 'Fill in a quantity, 0 when none');
          return undefined;
        }
        const text = cellText(cell).replace(/,/g, '').trim();
        if (!StockQuantity.safeParse(text).success) {
          problem(row, key, 'Write a quantity such as 12 or 0.5');
          return undefined;
        }
        return text;
      };
      const opening = quantity('opening', false);
      const received = quantity('received', true);
      const returned = quantity('returned', false) ?? '0';
      const closing = quantity('closing', true);
      if (!accountId || !period || !itemId || received === undefined || closing === undefined) {
        continue;
      }
      if (!reporting.has(accountId)) {
        const row_ = await this.accounts.row(tx, access.tenantId, accountId);
        const type = await this.types.byId(tx, access.tenantId, row_.typeId);
        if (!type.definition.sellThrough) {
          problem(row, 'account_code', 'This kind of account gives no stock statement');
          continue;
        }
        reporting.add(accountId);
      }
      const key = `${accountId}:${period}`;
      const group = groups.get(key) ?? { accountId, period, rows: [], lines: [] };
      if (group.lines.some((line) => line.itemId === itemId)) {
        problem(row, 'item_code', 'This item is in this month twice');
        continue;
      }
      group.rows.push(row);
      group.lines.push({
        itemId,
        ...(opening === undefined ? {} : { opening }),
        received,
        returned,
        closing,
      });
      groups.set(key, group);
    }
    return { problems, groups: [...groups.values()], today };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, groups } = await this.plan(tx, rows, context);
    return checked(
      problems,
      groups.map(() => ({ existing: false })),
    );
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, groups, today } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    const { access } = context;
    const person = access.support || access.apiClient ? null : access.userId;
    for (const group of groups) {
      const day = creditedDate(group.period, today);
      const creditTo =
        (await this.accounts.creditedOn(tx, access.tenantId, group.accountId, day)) ?? person;
      if (!creditTo) {
        throw new ImportRefused([
          { row: group.rows[0]!, field: 'account_code', issue: 'Nobody holds this account' },
        ]);
      }
      try {
        await this.sellThrough.record(tx, access, {
          id: newId(),
          accountId: group.accountId,
          period: group.period,
          lines: group.lines,
          creditTo,
        });
      } catch (error) {
        if (!(error instanceof AppError) || error.status >= 500) throw error;
        throw new ImportRefused([{ row: group.rows[0]!, field: null, issue: error.message }]);
      }
    }
    return { created: groups.length, updated: 0 };
  }
}
