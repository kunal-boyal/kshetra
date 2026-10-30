import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type FinanceSnapshotBody,
  type ImportProblem,
  type LedgerEntriesBody,
  Money,
  newId,
} from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { userActor } from '../../platform/audit';
import { AccountsService } from '../accounts/accounts.service';
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
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { FinanceService } from './finance.service';

/** An amount cell as a `Money` string: ₹, commas and spaces allowed (Appendix B). */
function amountOf(text: string): string | null {
  const cleaned = text.replace(/[₹,\s]/g, '');
  return Money.safeParse(cleaned).success ? cleaned : null;
}

/** The ageing bucket a person reads: "0–30 days", "Over 180 days". */
function bucketName(bucket: { fromDays: number; toDays: number | null }): string {
  return bucket.toDays === null
    ? `Over ${bucket.fromDays - 1} days`
    : `${bucket.fromDays}-${bucket.toDays} days`;
}

/**
 * Finance snapshot imports (Appendix B.6): account code, as-of date, outstanding, credit limit,
 * inventory value, one column per ageing bucket, and source. Every row adds a snapshot; the
 * account's latest is the one shown (decision D79).
 */
@Injectable()
export class FinanceSnapshotsImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'finance_snapshots';
  readonly permission = 'finance.manage';

  constructor(
    private readonly targets: ImportTargets,
    private readonly finance: FinanceService,
    private readonly accounts: AccountsService,
    private readonly config: TenantConfigService,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(tx: TenantTx, tenantId: string): Promise<TargetField[]> {
    const { ageingBuckets } = await this.config.settings(tx, tenantId);
    return [
      { key: 'account_code', names: ['Account code', 'Code', 'Customer code'], required: true },
      { key: 'as_of', names: ['As-of date', 'As of', 'Date'], required: true },
      { key: 'outstanding', names: ['Outstanding', 'Balance'], required: true },
      { key: 'credit_limit', names: ['Credit limit'], required: false },
      { key: 'inventory_value', names: ['Inventory value', 'Stock value'], required: false },
      ...ageingBuckets.map((bucket) => ({
        key: `ageing.${bucket.key}`,
        names: [bucketName(bucket), bucket.key],
        required: false,
        label: {
          en: bucketName(bucket),
          hi:
            bucket.toDays === null
              ? `${bucket.fromDays - 1} दिन से ज़्यादा`
              : `${bucket.fromDays}-${bucket.toDays} दिन`,
        },
      })),
      { key: 'source', names: ['Source'], required: true },
    ];
  }

  /** Two accounts' balances today, split over the tenant's first ageing buckets (D111). */
  async example(tx: TenantTx, tenantId: string): Promise<ExampleRow[]> {
    const { ageingBuckets } = await this.config.settings(tx, tenantId);
    const [first, second] = ageingBuckets;
    const asOf = new Date().toISOString().slice(0, 10);
    return [
      {
        account_code: 'A-101',
        as_of: asOf,
        outstanding: '125000.00',
        credit_limit: '200000.00',
        ...(first ? { [`ageing.${first.key}`]: '75000.00' } : {}),
        ...(second ? { [`ageing.${second.key}`]: '50000.00' } : {}),
        source: 'Accounts export',
      },
      {
        account_code: 'A-102',
        as_of: asOf,
        outstanding: '18500.00',
        credit_limit: '50000.00',
        ...(first ? { [`ageing.${first.key}`]: '18500.00' } : {}),
        source: 'Accounts export',
      },
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { access, emptyValues } = context;
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const empty = (cell: ImportRow['cells'][string] | undefined) =>
      cell === undefined || isEmptyCell(cell, emptyValues);
    const { ageingBuckets } = await this.config.settings(tx, access.tenantId);
    const ids = await this.accounts.seenByCode(
      tx,
      access,
      rows.map((row) => cellText(row.cells.account_code).trim()).filter(Boolean),
    );
    const planned: FinanceSnapshotBody[] = [];
    for (const { row, cells } of rows) {
      const code = cellText(cells.account_code).trim();
      const accountId = ids.get(code);
      if (!code) problem(row, 'account_code', 'Fill in the account code');
      else if (!accountId) problem(row, 'account_code', 'No account you see has this code');
      const asOf = cellDate(cells.as_of);
      if (!asOf) problem(row, 'as_of', 'Write the date as 2026-10-24 or 24-10-2026');
      const outstanding = amountOf(cellText(cells.outstanding));
      if (outstanding === null) problem(row, 'outstanding', 'Write an amount such as 12500.50');
      const optional = (key: 'credit_limit' | 'inventory_value') => {
        if (empty(cells[key])) return null;
        const amount = amountOf(cellText(cells[key]));
        if (amount === null) problem(row, key, 'Write an amount such as 12500.50');
        return amount;
      };
      const creditLimit = optional('credit_limit');
      const inventoryValue = optional('inventory_value');
      const ageing: Record<string, string> = {};
      for (const bucket of ageingBuckets) {
        const cell = cells[`ageing.${bucket.key}`];
        if (empty(cell)) continue;
        const amount = amountOf(cellText(cell));
        if (amount === null)
          problem(row, `ageing.${bucket.key}`, 'Write an amount such as 12500.50');
        else ageing[bucket.key] = amount;
      }
      const source = cellText(cells.source).trim().slice(0, 60);
      if (!source) problem(row, 'source', 'Say where the balance came from');
      if (!accountId || !asOf || outstanding === null || !source) continue;
      const snapshot: FinanceSnapshotBody = {
        id: newId(),
        accountId,
        asOf,
        outstanding,
        creditLimit,
        inventoryValue,
        ageing,
        source,
      };
      for (const issue of await this.finance.snapshotIssues(tx, access.tenantId, snapshot)) {
        problem(row, issue.path.startsWith('ageing') ? 'ageing' : 'as_of', issue.issue);
      }
      planned.push(snapshot);
    }
    return { problems, planned };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    return checked((await this.plan(tx, rows, context)).problems);
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    await this.finance.insertSnapshots(
      tx,
      context.access.tenantId,
      userActor(context.access),
      planned,
      null,
    );
    return { created: planned.length, updated: 0 };
  }
}

/**
 * Statement entry imports (Appendix B.6): the entry reference is the key, so a file loaded again
 * adds only its new entries; an entry that differs from the one stored fails, as entries are only
 * ever added (BR-21).
 */
@Injectable()
export class LedgerEntriesImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'ledger_entries';
  readonly permission = 'finance.manage';

  constructor(
    private readonly targets: ImportTargets,
    private readonly finance: FinanceService,
    private readonly accounts: AccountsService,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(): Promise<TargetField[]> {
    return [
      {
        key: 'reference',
        names: ['Entry reference', 'Reference', 'Voucher number'],
        required: true,
      },
      { key: 'account_code', names: ['Account code', 'Code', 'Customer code'], required: true },
      { key: 'date', names: ['Date', 'Voucher date'], required: true },
      { key: 'description', names: ['Description', 'Narration'], required: false },
      { key: 'debit', names: ['Debit', 'Dr'], required: false },
      { key: 'credit', names: ['Credit', 'Cr'], required: false },
    ];
  }

  /** An invoice and the payment against it (D111). */
  async example(): Promise<ExampleRow[]> {
    const day = new Date().toISOString().slice(0, 10);
    return [
      {
        reference: 'INV-2041',
        account_code: 'A-101',
        date: day,
        description: 'Invoice 2041',
        debit: '42000.00',
      },
      {
        reference: 'RCPT-118',
        account_code: 'A-101',
        date: day,
        description: 'Payment received',
        credit: '30000.00',
      },
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { access, emptyValues } = context;
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const empty = (cell: ImportRow['cells'][string] | undefined) =>
      cell === undefined || isEmptyCell(cell, emptyValues);
    const ids = await this.accounts.seenByCode(
      tx,
      access,
      rows.map((row) => cellText(row.cells.account_code).trim()).filter(Boolean),
    );
    const entries: { row: number; entry: LedgerEntriesBody['entries'][number] }[] = [];
    for (const { row, cells } of rows) {
      const reference = cellText(cells.reference).trim();
      if (!reference) problem(row, 'reference', 'Fill in the entry reference');
      else if (reference.length > 60) problem(row, 'reference', 'Use at most 60 characters');
      const code = cellText(cells.account_code).trim();
      const accountId = ids.get(code);
      if (!code) problem(row, 'account_code', 'Fill in the account code');
      else if (!accountId) problem(row, 'account_code', 'No account you see has this code');
      const date = cellDate(cells.date);
      if (!date) problem(row, 'date', 'Write the date as 2026-10-24 or 24-10-2026');
      const side = (key: 'debit' | 'credit') => {
        if (empty(cells[key])) return '0';
        const amount = amountOf(cellText(cells[key]));
        if (amount === null) problem(row, key, 'Write an amount such as 12500.50');
        return amount ?? '0';
      };
      const debit = side('debit');
      const credit = side('credit');
      if (!reference || reference.length > 60 || !accountId || !date) continue;
      entries.push({
        row,
        entry: {
          id: newId(),
          accountId,
          date,
          reference,
          description: empty(cells.description)
            ? null
            : cellText(cells.description).trim().slice(0, 200),
          debit,
          credit,
        },
      });
    }
    const { issues, fresh, unchanged } = await this.finance.planEntries(
      tx,
      access.tenantId,
      entries.map((entry) => entry.entry),
      (index, field) => [index, field],
    );
    for (const issue of issues) {
      const [index, field] = issue.path.split('.') as [string, string];
      const row = entries[Number(index.replace(/\D/g, ''))]?.row ?? 0;
      problem(row, field === 'accountId' ? 'account_code' : field, issue.issue);
    }
    return { problems, fresh, unchanged };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, fresh } = await this.plan(tx, rows, context);
    // Entries already in the statement are left as they are; only new ones are added.
    return checked(
      problems,
      fresh.map(() => ({ existing: false })),
    );
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, fresh } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    await this.finance.insertEntries(
      tx,
      context.access.tenantId,
      userActor(context.access),
      fresh,
      'import',
      null,
    );
    return { created: fresh.length, updated: 0 };
  }
}
