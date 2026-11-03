import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type ImportProblem,
  type ImportTarget,
  RECORDED_MOVEMENT_KINDS,
  type RecordedMovementKind,
  SignedStockQuantity,
  signedUnits,
  StockQuantity,
  todayIn,
} from '@thelamp/shared';
import { userActor } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { AccountTypesService } from '../accounts/account-types.service';
import { AccountsService } from '../accounts/accounts.service';
import { CatalogueService } from '../catalogue/catalogue.service';
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
import { StockService } from './stock.service';

/** The words files use for each kind of movement, lower case. */
const KIND_WORDS: Record<string, RecordedMovementKind> = {
  opening: 'opening',
  received: 'received',
  receipt: 'received',
  purchase: 'received',
  in: 'received',
  sold: 'sold',
  sale: 'sold',
  out: 'sold',
  'returned in': 'returned_in',
  returned_in: 'returned_in',
  'return in': 'returned_in',
  'returned out': 'returned_out',
  returned_out: 'returned_out',
  'return out': 'returned_out',
  corrected: 'corrected',
  correction: 'corrected',
  adjustment: 'corrected',
};

/** What both stock imports share: the account by its code, of a type that keeps stock, and the item. */
abstract class StockRows {
  constructor(
    protected readonly accounts: AccountsService,
    protected readonly types: AccountTypesService,
    protected readonly catalogue: CatalogueService,
    protected readonly config: TenantConfigService,
  ) {}

  protected async lookups(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { access } = context;
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
    const settings = await this.config.settings(tx, access.tenantId);
    const keeps = new Map<string, boolean>();
    const holds = async (accountId: string) => {
      if (!keeps.has(accountId)) {
        const account = await this.accounts.row(tx, access.tenantId, accountId);
        keeps.set(
          accountId,
          (await this.types.byId(tx, access.tenantId, account.typeId)).definition.keepsStock,
        );
      }
      return keeps.get(accountId)!;
    };
    return { ids, items, settings, holds, today: todayIn(settings.timezone) };
  }

  protected async accountAndItem(
    row: number,
    cells: ImportRow['cells'],
    found: Awaited<ReturnType<StockRows['lookups']>>,
    problem: (row: number, field: string | null, issue: string) => void,
  ) {
    const code = cellText(cells.account_code).trim();
    const accountId = found.ids.get(code);
    if (!code) problem(row, 'account_code', 'Fill in the account code');
    else if (!accountId) problem(row, 'account_code', 'No account you see has this code');
    else if (!(await found.holds(accountId))) {
      problem(row, 'account_code', 'This kind of account holds no stock');
    }
    const itemId = found.items.get(cellText(cells.item_code).trim());
    if (!itemId) problem(row, 'item_code', 'There is no item with this code');
    return { accountId, itemId };
  }
}

/**
 * Stock movements by file or the bulk API (BR-62, decision D130): goods in and out of accounts
 * that keep stock, such as a distributor's own sales from its system, while the app keeps stock.
 * Each row's reference makes it move stock once, however often the file is loaded.
 */
@Injectable()
export class StockMovementsImport extends StockRows implements ImportTargetSource, OnModuleInit {
  readonly name = 'stock_movements';
  readonly permission = 'stock.record';

  constructor(
    private readonly targets: ImportTargets,
    private readonly stock: StockService,
    accounts: AccountsService,
    types: AccountTypesService,
    catalogue: CatalogueService,
    config: TenantConfigService,
  ) {
    super(accounts, types, catalogue, config);
  }

  onModuleInit(): void {
    this.targets.register(this);
  }

  /** Only while the app keeps stock; with stock from the books, levels load instead (D139). */
  async offered(tx: TenantTx, tenantId: string): Promise<ImportTarget[]> {
    const { stockSource } = await this.config.settings(tx, tenantId);
    return stockSource === 'kept' ? ['stock_movements'] : [];
  }

  async fields(): Promise<TargetField[]> {
    return [
      { key: 'account_code', names: ['Account code', 'Code', 'Customer code'], required: true },
      { key: 'item_code', names: ['Item code', 'SKU', 'Product code'], required: true },
      { key: 'kind', names: ['Kind', 'Movement', 'Type'], required: true },
      { key: 'quantity', names: ['Quantity', 'Qty', 'Units'], required: true },
      { key: 'date', names: ['Date', 'Day'], required: false },
      { key: 'reference', names: ['Reference', 'Document', 'Bill number'], required: true },
    ];
  }

  async example(tx: TenantTx, tenantId: string): Promise<ExampleRow[]> {
    const { timezone } = await this.config.settings(tx, tenantId);
    const today = todayIn(timezone);
    const [first, second] = (await this.catalogue.items(tx, tenantId)).filter(
      (item) => item.active,
    );
    return [
      {
        account_code: 'A-101',
        item_code: first?.code ?? 'ITEM-1',
        kind: 'received',
        quantity: '48',
        date: today,
        reference: 'GRN-2041',
      },
      {
        account_code: 'A-101',
        item_code: second?.code ?? 'ITEM-2',
        kind: 'sold',
        quantity: '12',
        date: today,
        reference: 'BILL-0877',
      },
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const found = await this.lookups(tx, rows, context);
    if (found.settings.stockSource !== 'kept') {
      problems.push({
        row: null,
        field: null,
        issue: 'Stock comes from the books here; load levels instead',
      });
      return { problems, planned: [] };
    }
    const planned: {
      accountId: string;
      itemId: string;
      kind: RecordedMovementKind;
      units: string;
      occurredOn: string;
      reference: string;
    }[] = [];
    const seen = new Set<string>();
    for (const { row, cells } of rows) {
      const { accountId, itemId } = await this.accountAndItem(row, cells, found, problem);
      const kind = KIND_WORDS[cellText(cells.kind).trim().toLowerCase()];
      if (!kind || !RECORDED_MOVEMENT_KINDS.includes(kind)) {
        problem(
          row,
          'kind',
          'Write received, sold, returned in, returned out, opening or corrected',
        );
      }
      const quantity = cellText(cells.quantity).replace(/,/g, '').trim();
      const shape = kind === 'corrected' ? SignedStockQuantity : StockQuantity;
      if (!shape.safeParse(quantity).success) {
        problem(row, 'quantity', 'Write a quantity such as 12 or 0.5');
      }
      let occurredOn = found.today;
      if (!isEmptyCell(cells.date, context.emptyValues)) {
        const day = cellDate(cells.date);
        if (!day) problem(row, 'date', 'Write the date as 2026-11-02');
        else if (day > found.today) problem(row, 'date', 'This date is still to come');
        else occurredOn = day;
      }
      const reference = cellText(cells.reference).trim().slice(0, 100);
      if (!reference) problem(row, 'reference', 'Fill in the document’s reference');
      if (!accountId || !itemId || !kind || !reference) continue;
      const key = `${accountId}:${reference}:${itemId}:${kind}`;
      if (seen.has(key)) {
        problem(row, 'reference', 'This item moves twice in this file under one reference');
        continue;
      }
      seen.add(key);
      if (!shape.safeParse(quantity).success) continue;
      planned.push({
        accountId,
        itemId,
        kind,
        units: signedUnits(kind, quantity),
        occurredOn,
        reference,
      });
    }
    return { problems, planned };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    return checked(
      problems,
      planned.map(() => ({ existing: false })),
    );
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    const { access } = context;
    const written = await this.stock.apply(
      tx,
      access.tenantId,
      planned.map((entry) => ({
        accountId: entry.accountId,
        itemId: entry.itemId,
        kind: entry.kind,
        units: entry.units,
        occurredOn: entry.occurredOn,
        sourceType: 'import',
        sourceId: null,
        // Loaded again, a row moves nothing more.
        sourceKey: `import:${entry.accountId}:${entry.reference}:${entry.itemId}:${entry.kind}`,
        note: entry.reference,
        createdBy: access.support || access.apiClient ? null : access.userId,
      })),
    );
    if (written.length > 0) {
      await this.stock.imported(tx, access.tenantId, userActor(access), written.length);
    }
    return { created: written.length, updated: 0 };
  }
}

/**
 * Stock levels by file or the bulk API (BR-62, decision D130): what each account holds of each
 * item on a day. While the books keep stock, a level replaces the account's; while the app keeps
 * it, a level is an opening, which the ledger moves to.
 */
@Injectable()
export class StockLevelsImport extends StockRows implements ImportTargetSource, OnModuleInit {
  readonly name = 'stock_levels';
  readonly permission = 'stock.record';

  constructor(
    private readonly targets: ImportTargets,
    private readonly stock: StockService,
    accounts: AccountsService,
    types: AccountTypesService,
    catalogue: CatalogueService,
    config: TenantConfigService,
  ) {
    super(accounts, types, catalogue, config);
  }

  onModuleInit(): void {
    this.targets.register(this);
  }

  /** Only while stock comes from the books; the app's ledger takes movements (D139). */
  async offered(tx: TenantTx, tenantId: string): Promise<ImportTarget[]> {
    const { stockSource } = await this.config.settings(tx, tenantId);
    return stockSource === 'books' ? ['stock_levels'] : [];
  }

  async fields(): Promise<TargetField[]> {
    return [
      { key: 'account_code', names: ['Account code', 'Code', 'Customer code'], required: true },
      { key: 'item_code', names: ['Item code', 'SKU', 'Product code'], required: true },
      { key: 'on_hand', names: ['On hand', 'Stock', 'Closing', 'Quantity'], required: true },
      { key: 'as_of', names: ['As of', 'Date'], required: false },
    ];
  }

  async example(tx: TenantTx, tenantId: string): Promise<ExampleRow[]> {
    const { timezone } = await this.config.settings(tx, tenantId);
    const today = todayIn(timezone);
    const [first, second] = (await this.catalogue.items(tx, tenantId)).filter(
      (item) => item.active,
    );
    return [
      { account_code: 'A-101', item_code: first?.code ?? 'ITEM-1', on_hand: '120', as_of: today },
      { account_code: 'A-101', item_code: second?.code ?? 'ITEM-2', on_hand: '36', as_of: today },
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const found = await this.lookups(tx, rows, context);
    const planned: { accountId: string; itemId: string; onHand: string; asOf: string }[] = [];
    const seen = new Set<string>();
    for (const { row, cells } of rows) {
      const { accountId, itemId } = await this.accountAndItem(row, cells, found, problem);
      const onHand = cellText(cells.on_hand).replace(/,/g, '').trim();
      if (!SignedStockQuantity.safeParse(onHand).success) {
        problem(row, 'on_hand', 'Write a quantity such as 12 or 0.5');
      }
      let asOf = found.today;
      if (!isEmptyCell(cells.as_of, context.emptyValues)) {
        const day = cellDate(cells.as_of);
        if (!day) problem(row, 'as_of', 'Write the date as 2026-11-02');
        else if (day > found.today) problem(row, 'as_of', 'This date is still to come');
        else asOf = day;
      }
      if (!accountId || !itemId || !SignedStockQuantity.safeParse(onHand).success) continue;
      if (seen.has(`${accountId}:${itemId}`)) {
        problem(row, 'item_code', 'This item is in this file twice for this account');
        continue;
      }
      seen.add(`${accountId}:${itemId}`);
      planned.push({ accountId, itemId, onHand, asOf });
    }
    return { problems, planned };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    return checked(
      problems,
      planned.map(() => ({ existing: true })),
    );
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    const { access } = context;
    return this.stock.load(
      tx,
      access.tenantId,
      userActor(access),
      access.support || access.apiClient ? null : access.userId,
      planned,
      'import',
    );
  }
}
