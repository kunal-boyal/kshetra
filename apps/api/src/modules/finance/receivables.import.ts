import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type ErrorDetail, type ImportProblem, invoiceDueDate } from '@thelamp/shared';
import { userActor } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
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
import { amountOf } from './finance.import';
import {
  type DocumentPlan,
  type InvoiceInput,
  type ReceiptInput,
  ReceivablesService,
} from './receivables.service';

/** A document number: up to 60 characters, as the customer's books write it. */
const NUMBER_MAX = 60;

type Cell = ImportRow['cells'][string] | undefined;

/** The status column: open (or blank) or cancelled. */
function cancelledOf(text: string): boolean | null {
  const value = text.trim().toLowerCase();
  if (value === '' || value === 'open' || value === 'active') return false;
  if (value === 'cancelled' || value === 'canceled' || value === 'void') return true;
  return null;
}

/** Problems of a plan, by the file's rows: a planned index maps back to its row. */
function planProblems<T>(
  plan: DocumentPlan<T>,
  rows: readonly number[],
  field: (key: string) => string,
): ImportProblem[] {
  return plan.issues.map((issue: ErrorDetail) => {
    // Paths read `[3].accountId`: the planned document's index, then its field.
    const [, index = '', key = ''] = /^\[(\d+)\]\.(.+)$/.exec(issue.path) ?? [];
    return { row: rows[Number(index)] ?? 0, field: field(key), issue: issue.issue };
  });
}

/** The cells every document shares: its number, account and date. */
async function common(
  tx: TenantTx,
  accounts: AccountsService,
  rows: readonly ImportRow[],
  context: ImportContext,
  problem: (row: number, field: string | null, issue: string) => void,
) {
  const ids = await accounts.seenByCode(
    tx,
    context.access,
    rows.map((row) => cellText(row.cells.account_code).trim()).filter(Boolean),
  );
  return (row: number, cells: ImportRow['cells']) => {
    const number = cellText(cells.number).trim();
    if (!number) problem(row, 'number', 'Fill in the number');
    else if (number.length > NUMBER_MAX) problem(row, 'number', 'Use at most 60 characters');
    const code = cellText(cells.account_code).trim();
    const accountId = ids.get(code);
    if (!code) problem(row, 'account_code', 'Fill in the account code');
    else if (!accountId) problem(row, 'account_code', 'No account you see has this code');
    const date = cellDate(cells.date);
    if (!date) problem(row, 'date', 'Write the date as 2026-10-24 or 24-10-2026');
    const amount = amountOf(cellText(cells.amount));
    if (amount === null || Number(amount) <= 0) {
      problem(row, 'amount', 'Write an amount above zero, such as 12500.50');
    }
    const cancelled = cancelledOf(cellText(cells.status));
    if (cancelled === null) problem(row, 'status', 'Write open or cancelled');
    return number &&
      number.length <= NUMBER_MAX &&
      accountId &&
      date &&
      amount &&
      cancelled !== null
      ? { number, accountId, date, amount, cancelled }
      : null;
  };
}

/**
 * Invoice imports (M11, BR-51, decision D121): the invoice number is the key, so a file loaded
 * again changes only what changed; the due date comes from the file, or its credit days, or the
 * tenant's default credit days. The bulk API serves the same target.
 */
@Injectable()
export class InvoicesImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'invoices';
  readonly permission = 'finance.manage';

  constructor(
    private readonly targets: ImportTargets,
    private readonly receivables: ReceivablesService,
    private readonly accounts: AccountsService,
    private readonly config: TenantConfigService,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(): Promise<TargetField[]> {
    return [
      { key: 'number', names: ['Invoice number', 'Invoice no', 'Bill number'], required: true },
      { key: 'account_code', names: ['Account code', 'Code', 'Customer code'], required: true },
      { key: 'date', names: ['Invoice date', 'Date', 'Bill date'], required: true },
      { key: 'amount', names: ['Amount', 'Invoice amount', 'Bill amount'], required: true },
      { key: 'due_date', names: ['Due date', 'Due on'], required: false },
      { key: 'credit_days', names: ['Credit days', 'Credit period'], required: false },
      { key: 'status', names: ['Status'], required: false },
    ];
  }

  /** Two invoices of one account, one with its due date and one by credit days (D111). */
  async example(): Promise<ExampleRow[]> {
    const day = new Date().toISOString().slice(0, 10);
    return [
      {
        number: 'INV-2041',
        account_code: 'A-101',
        date: day,
        amount: '42000.00',
        due_date: invoiceDueDate(day, 30),
        status: 'open',
      },
      {
        number: 'INV-2042',
        account_code: 'A-101',
        date: day,
        amount: '18500.00',
        credit_days: '45',
      },
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const empty = (cell: Cell) => cell === undefined || isEmptyCell(cell, context.emptyValues);
    const settings = await this.config.settings(tx, context.access.tenantId);
    const read = await common(tx, this.accounts, rows, context, problem);
    const inputs: InvoiceInput[] = [];
    const rowOf: number[] = [];
    for (const { row, cells } of rows) {
      const base = read(row, cells);
      let dueDate: string | null = null;
      if (!empty(cells.due_date)) {
        dueDate = cellDate(cells.due_date);
        if (!dueDate) problem(row, 'due_date', 'Write the date as 2026-10-24 or 24-10-2026');
      } else {
        let days = settings.defaultCreditDays;
        if (!empty(cells.credit_days)) {
          const given = Number(cellText(cells.credit_days).trim());
          if (!Number.isInteger(given) || given < 0 || given > 365) {
            problem(row, 'credit_days', 'Write whole days from 0 to 365');
          } else days = given;
        }
        if (base) dueDate = invoiceDueDate(base.date, days);
      }
      if (base && dueDate && dueDate < base.date) {
        problem(row, 'due_date', 'The due date can’t be before the invoice date');
        continue;
      }
      if (!base || !dueDate) continue;
      inputs.push({ ...base, dueDate });
      rowOf.push(row);
    }
    const plan = await this.receivables.planInvoices(tx, context.access.tenantId, inputs);
    problems.push(
      ...planProblems(plan, rowOf, (key) => (key === 'accountId' ? 'account_code' : key)),
    );
    return { problems, plan };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, plan } = await this.plan(tx, rows, context);
    return checked(problems, [
      ...plan.fresh.map(() => ({ existing: false })),
      ...plan.changed.map(() => ({ existing: true })),
    ]);
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, plan } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    await this.receivables.writeInvoices(
      tx,
      context.access.tenantId,
      userActor(context.access),
      plan,
      'import',
      null,
    );
    return { created: plan.fresh.length, updated: plan.changed.length };
  }
}

/**
 * Receipt and credit note imports (M11, BR-51, D121): the receipt number is the key, and the
 * invoices it pays are listed by number, separated by `;`; what it doesn't name settles the
 * account's oldest open invoices.
 */
@Injectable()
export class ReceiptsImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'receipts';
  readonly permission = 'finance.manage';

  constructor(
    private readonly targets: ImportTargets,
    private readonly receivables: ReceivablesService,
    private readonly accounts: AccountsService,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(): Promise<TargetField[]> {
    return [
      { key: 'number', names: ['Receipt number', 'Receipt no', 'Voucher number'], required: true },
      { key: 'account_code', names: ['Account code', 'Code', 'Customer code'], required: true },
      { key: 'date', names: ['Receipt date', 'Date', 'Voucher date'], required: true },
      { key: 'amount', names: ['Amount', 'Receipt amount'], required: true },
      { key: 'kind', names: ['Kind', 'Type'], required: false },
      { key: 'against', names: ['Against invoices', 'Against', 'Bills'], required: false },
      { key: 'status', names: ['Status'], required: false },
    ];
  }

  /** A payment against an invoice, and a credit note settling the oldest (D111). */
  async example(): Promise<ExampleRow[]> {
    const day = new Date().toISOString().slice(0, 10);
    return [
      {
        number: 'RCPT-118',
        account_code: 'A-101',
        date: day,
        amount: '30000.00',
        kind: 'receipt',
        against: 'INV-2041',
      },
      { number: 'CN-12', account_code: 'A-101', date: day, amount: '1500.00', kind: 'credit note' },
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const read = await common(tx, this.accounts, rows, context, problem);
    const inputs: ReceiptInput[] = [];
    const rowOf: number[] = [];
    for (const { row, cells } of rows) {
      const base = read(row, cells);
      const kindText = cellText(cells.kind)
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
      const kind =
        kindText === '' || kindText === 'receipt' || kindText === 'payment'
          ? 'receipt'
          : kindText === 'credit_note' || kindText === 'cn'
            ? 'credit_note'
            : null;
      if (!kind) problem(row, 'kind', 'Write receipt or credit note');
      const against = cellText(cells.against)
        .split(/[;,]/)
        .map((number) => number.trim())
        .filter(Boolean);
      if (against.some((number) => number.length > NUMBER_MAX) || against.length > 50) {
        problem(row, 'against', 'List at most 50 invoice numbers of up to 60 characters');
        continue;
      }
      if (!base || !kind) continue;
      inputs.push({ ...base, kind, against: [...new Set(against)] });
      rowOf.push(row);
    }
    const plan = await this.receivables.planReceipts(tx, context.access.tenantId, inputs);
    problems.push(
      ...planProblems(plan, rowOf, (key) => (key === 'accountId' ? 'account_code' : key)),
    );
    return { problems, plan };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, plan } = await this.plan(tx, rows, context);
    return checked(problems, [
      ...plan.fresh.map(() => ({ existing: false })),
      ...plan.changed.map(() => ({ existing: true })),
    ]);
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, plan } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    await this.receivables.writeReceipts(
      tx,
      context.access.tenantId,
      userActor(context.access),
      plan,
      'import',
      null,
    );
    return { created: plan.fresh.length, updated: plan.changed.length };
  }
}
