import { Injectable } from '@nestjs/common';
import {
  type AccountInvoiceListResult,
  type AccountInvoiceQuery,
  type AccountReceiptListResult,
  type AccountReceiptQuery,
  type ErrorDetail,
  invoiceAgeing,
  issueAt,
  newId,
  type ReceivablesFigures,
  type RegisterInvoice,
  type RegisterReceipt,
  scaled,
  settleInvoices,
  todayIn,
} from '@thelamp/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { accountInvoices, accountReceipts } from '../../db/schema/finance';
import { type AuditActor, AuditLog } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { CollectionsService } from './collections.service';

export interface InvoiceInput {
  number: string;
  accountId: string;
  date: string;
  dueDate: string;
  amount: string;
  cancelled: boolean;
}

export interface ReceiptInput {
  number: string;
  accountId: string;
  date: string;
  amount: string;
  kind: 'receipt' | 'credit_note';
  against: string[];
  cancelled: boolean;
}

type InvoiceRow = typeof accountInvoices.$inferSelect;
type ReceiptRow = typeof accountReceipts.$inferSelect;

/** What a file of documents would do: add, change, leave alone, or refuse, by its index. */
export interface DocumentPlan<T> {
  fresh: T[];
  changed: { id: string; before: T; after: T }[];
  unchanged: number;
  issues: ErrorDetail[];
}

const sameAmount = (a: string, b: string) => scaled(a, 2) === scaled(b, 2);

const invoiceOf = (row: InvoiceRow): InvoiceInput => ({
  number: row.number,
  accountId: row.accountId,
  date: row.date,
  dueDate: row.dueDate,
  amount: row.amount,
  cancelled: row.cancelled,
});

const receiptOf = (row: ReceiptRow): ReceiptInput => ({
  number: row.number,
  accountId: row.accountId,
  date: row.date,
  amount: row.amount,
  kind: row.kind,
  against: row.against,
  cancelled: row.cancelled,
});

const sameInvoice = (a: InvoiceInput, b: InvoiceInput) =>
  a.date === b.date &&
  a.dueDate === b.dueDate &&
  sameAmount(a.amount, b.amount) &&
  a.cancelled === b.cancelled;

const sameReceipt = (a: ReceiptInput, b: ReceiptInput) =>
  a.date === b.date &&
  sameAmount(a.amount, b.amount) &&
  a.kind === b.kind &&
  a.cancelled === b.cancelled &&
  a.against.join(';') === b.against.join(';');

/** One account's documents, as settling reads them. */
interface Documents {
  invoices: InvoiceRow[];
  receipts: ReceiptRow[];
}

const registerInvoice = (row: InvoiceRow): RegisterInvoice => ({
  number: row.number,
  date: row.date,
  dueDate: row.dueDate,
  amount: row.amount,
  cancelled: row.cancelled,
});

const registerReceipt = (row: ReceiptRow): RegisterReceipt => ({
  number: row.number,
  date: row.date,
  amount: row.amount,
  against: row.against,
  cancelled: row.cancelled,
});

/** A page of rows already in order, after the row a cursor names. */
function page<T>(rows: readonly T[], key: (row: T) => string, limit: number, cursor?: string) {
  const start = cursor ? rows.findIndex((row) => key(row) === cursor) + 1 : 0;
  const items = rows.slice(start, start + limit);
  const more = start + limit < rows.length;
  return { items, nextCursor: more && items.length > 0 ? key(items[items.length - 1]!) : null };
}

/**
 * Invoices and receipts from the customer's books (M11, BR-51, decision D121): each keyed by its
 * number, recorded, corrected or cancelled as files and the bulk API send them, and settled on
 * read into each account's open invoices, outstanding and ageing.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
    private readonly collections: CollectionsService,
  ) {}

  /** What a list of invoices would do, by its index: a document never moves account. */
  async planInvoices(
    tx: TenantTx,
    tenantId: string,
    inputs: readonly InvoiceInput[],
  ): Promise<DocumentPlan<InvoiceInput>> {
    const numbers = inputs.map((input) => input.number);
    const stored = new Map(
      (numbers.length === 0
        ? []
        : await tx
            .select()
            .from(accountInvoices)
            .where(
              and(eq(accountInvoices.tenantId, tenantId), inArray(accountInvoices.number, numbers)),
            )
      ).map((row) => [row.number, row]),
    );
    return this.plan(inputs, stored, invoiceOf, sameInvoice, 'This invoice');
  }

  /** What a list of receipts would do, by its index. */
  async planReceipts(
    tx: TenantTx,
    tenantId: string,
    inputs: readonly ReceiptInput[],
  ): Promise<DocumentPlan<ReceiptInput>> {
    const numbers = inputs.map((input) => input.number);
    const stored = new Map(
      (numbers.length === 0
        ? []
        : await tx
            .select()
            .from(accountReceipts)
            .where(
              and(eq(accountReceipts.tenantId, tenantId), inArray(accountReceipts.number, numbers)),
            )
      ).map((row) => [row.number, row]),
    );
    return this.plan(inputs, stored, receiptOf, sameReceipt, 'This receipt');
  }

  private plan<T extends { number: string; accountId: string }, R extends { id: string }>(
    inputs: readonly T[],
    stored: ReadonlyMap<string, R>,
    of: (row: R) => T,
    same: (a: T, b: T) => boolean,
    what: string,
  ): DocumentPlan<T> {
    const plan: DocumentPlan<T> = { fresh: [], changed: [], unchanged: 0, issues: [] };
    const seen = new Set<string>();
    inputs.forEach((input, index) => {
      if (seen.has(input.number)) {
        plan.issues.push(issueAt([index, 'number'], 'This number appears twice in the file'));
        return;
      }
      seen.add(input.number);
      const row = stored.get(input.number);
      if (!row) {
        plan.fresh.push(input);
        return;
      }
      const before = of(row);
      if (before.accountId !== input.accountId) {
        plan.issues.push(issueAt([index, 'accountId'], `${what} belongs to another account`));
      } else if (same(before, input)) {
        plan.unchanged += 1;
      } else {
        plan.changed.push({ id: row.id, before, after: input });
      }
    });
    return plan;
  }

  /** Records new invoices and applies corrections, auditing each change (D121). */
  async writeInvoices(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    plan: DocumentPlan<InvoiceInput>,
    source: string,
    importId: string | null,
  ): Promise<void> {
    const by = actor.kind === 'user' ? actor.id : null;
    if (plan.fresh.length > 0) {
      await tx.insert(accountInvoices).values(
        plan.fresh.map((invoice) => ({
          ...invoice,
          id: newId(),
          tenantId,
          source,
          importId,
          createdBy: by,
          updatedBy: by,
        })),
      );
      await this.audit.record(tx, tenantId, actor, {
        action: 'finance.invoices_recorded',
        target: { type: 'account', id: null },
        after: { count: plan.fresh.length, numbers: plan.fresh.map((i) => i.number), importId },
      });
    }
    for (const change of plan.changed) {
      const { date, dueDate, amount, cancelled } = change.after;
      await tx
        .update(accountInvoices)
        .set({
          date,
          dueDate,
          amount,
          cancelled,
          source,
          importId,
          updatedBy: by,
          updatedAt: new Date(),
        })
        .where(and(eq(accountInvoices.tenantId, tenantId), eq(accountInvoices.id, change.id)));
      await this.audit.record(tx, tenantId, actor, {
        action:
          change.after.cancelled && !change.before.cancelled
            ? 'finance.invoice_cancelled'
            : 'finance.invoice_changed',
        target: { type: 'invoice', id: change.id },
        before: change.before,
        after: change.after,
      });
    }
  }

  /** Records new receipts and applies corrections, auditing each change (D121). */
  async writeReceipts(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    plan: DocumentPlan<ReceiptInput>,
    source: string,
    importId: string | null,
  ): Promise<void> {
    const by = actor.kind === 'user' ? actor.id : null;
    if (plan.fresh.length > 0) {
      await tx.insert(accountReceipts).values(
        plan.fresh.map((receipt) => ({
          ...receipt,
          id: newId(),
          tenantId,
          source,
          importId,
          createdBy: by,
          updatedBy: by,
        })),
      );
      await this.audit.record(tx, tenantId, actor, {
        action: 'finance.receipts_recorded',
        target: { type: 'account', id: null },
        after: { count: plan.fresh.length, numbers: plan.fresh.map((r) => r.number), importId },
      });
    }
    for (const change of plan.changed) {
      const { date, amount, kind, against, cancelled } = change.after;
      await tx
        .update(accountReceipts)
        .set({
          date,
          amount,
          kind,
          against,
          cancelled,
          source,
          importId,
          updatedBy: by,
          updatedAt: new Date(),
        })
        .where(and(eq(accountReceipts.tenantId, tenantId), eq(accountReceipts.id, change.id)));
      await this.audit.record(tx, tenantId, actor, {
        action:
          change.after.cancelled && !change.before.cancelled
            ? 'finance.receipt_cancelled'
            : 'finance.receipt_changed',
        target: { type: 'receipt', id: change.id },
        before: change.before,
        after: change.after,
      });
    }
    // The field's collections these receipts are, by BR-63 (decision D132).
    const changedIds = plan.changed.map((change) => change.id);
    const changedAccounts =
      changedIds.length === 0
        ? []
        : await tx
            .select({ accountId: accountReceipts.accountId })
            .from(accountReceipts)
            .where(
              and(eq(accountReceipts.tenantId, tenantId), inArray(accountReceipts.id, changedIds)),
            );
    await this.collections.match(
      tx,
      tenantId,
      [
        ...plan.fresh.map((receipt) => receipt.accountId),
        ...changedAccounts.map((row) => row.accountId),
      ],
      actor,
    );
  }

  /** The documents of some accounts, by account; accounts without any are left out. */
  private async documents(
    tx: TenantTx,
    tenantId: string,
    accountIds: readonly string[],
  ): Promise<Map<string, Documents>> {
    const found = new Map<string, Documents>();
    if (accountIds.length === 0) return found;
    const ids = [...new Set(accountIds)];
    const of = (accountId: string) => {
      let documents = found.get(accountId);
      if (!documents) found.set(accountId, (documents = { invoices: [], receipts: [] }));
      return documents;
    };
    for (const row of await tx
      .select()
      .from(accountInvoices)
      .where(
        and(eq(accountInvoices.tenantId, tenantId), inArray(accountInvoices.accountId, ids)),
      )) {
      of(row.accountId).invoices.push(row);
    }
    for (const row of await tx
      .select()
      .from(accountReceipts)
      .where(
        and(eq(accountReceipts.tenantId, tenantId), inArray(accountReceipts.accountId, ids)),
      )) {
      of(row.accountId).receipts.push(row);
    }
    return found;
  }

  /**
   * Each account's receivables on a day, worked out from its invoices (BR-51); accounts with no
   * invoice are left out, as their snapshots speak for them (D121).
   */
  async receivables(
    tx: TenantTx,
    tenantId: string,
    accountIds: readonly string[],
    asOf?: string,
  ): Promise<Map<string, ReceivablesFigures & { asOf: string }>> {
    const settings = await this.config.settings(tx, tenantId);
    const day = asOf ?? todayIn(settings.timezone);
    const result = new Map<string, ReceivablesFigures & { asOf: string }>();
    for (const [accountId, documents] of await this.documents(tx, tenantId, accountIds)) {
      if (documents.invoices.length === 0) continue;
      // Documents dated after the day don't count yet.
      const invoices = documents.invoices.filter((row) => row.date <= day).map(registerInvoice);
      const receipts = documents.receipts.filter((row) => row.date <= day).map(registerReceipt);
      const settled = settleInvoices(invoices, receipts);
      result.set(accountId, {
        ...invoiceAgeing(invoices, settled, settings.ageingBuckets, day),
        asOf: day,
      });
    }
    return result;
  }

  /** `GET /v1/accounts/{id}/invoices`: open ones or all, latest due date first (BR-51). */
  async invoiceList(
    tx: TenantTx,
    access: Access,
    accountId: string,
    query: AccountInvoiceQuery,
  ): Promise<AccountInvoiceListResult> {
    await this.accounts.find(tx, access, accountId);
    const today = todayIn((await this.config.settings(tx, access.tenantId)).timezone);
    const documents = (await this.documents(tx, access.tenantId, [accountId])).get(accountId);
    if (!documents) return { items: [], nextCursor: null };
    const settled = settleInvoices(
      documents.invoices.map(registerInvoice),
      documents.receipts.map(registerReceipt),
    );
    const rows = documents.invoices
      .map((row) => {
        const open = settled.open.get(row.number) ?? '0.00';
        const owing = !row.cancelled && scaled(open, 2) > 0n;
        const late =
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${row.dueDate}T00:00:00Z`)) / 86_400_000;
        return {
          id: row.id,
          number: row.number,
          date: row.date,
          dueDate: row.dueDate,
          amount: row.amount,
          open: row.cancelled ? '0.00' : open,
          daysPastDue: owing && late >= 0 ? late : null,
          cancelled: row.cancelled,
          settledBy: settled.settlements
            .filter((entry) => entry.invoice === row.number)
            .map((entry) => ({ receipt: entry.receipt, amount: entry.amount })),
        };
      })
      .filter((row) => query.status === 'all' || scaled(row.open, 2) > 0n)
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.number.localeCompare(b.number));
    return page(rows, (row) => row.number, query.limit, query.cursor);
  }

  /** `GET /v1/accounts/{id}/receipts`: newest first, with what each settled (BR-51). */
  async receiptList(
    tx: TenantTx,
    access: Access,
    accountId: string,
    query: AccountReceiptQuery,
  ): Promise<AccountReceiptListResult> {
    await this.accounts.find(tx, access, accountId);
    const documents = (await this.documents(tx, access.tenantId, [accountId])).get(accountId);
    if (!documents) return { items: [], nextCursor: null };
    const settled = settleInvoices(
      documents.invoices.map(registerInvoice),
      documents.receipts.map(registerReceipt),
    );
    const rows = documents.receipts
      .map((row) => ({
        id: row.id,
        number: row.number,
        date: row.date,
        amount: row.amount,
        kind: row.kind,
        against: row.against,
        cancelled: row.cancelled,
        settled: settled.settlements
          .filter((entry) => entry.receipt === row.number)
          .map((entry) => ({ invoice: entry.invoice, amount: entry.amount })),
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.number.localeCompare(b.number));
    return page(rows, (row) => row.number, query.limit, query.cursor);
  }

  /** The latest receipt of each account on or before a day, for the outstanding report. */
  async lastReceipts(
    tx: TenantTx,
    tenantId: string,
    accountIds: readonly string[],
    asOf: string,
  ): Promise<Map<string, { date: string; amount: string }>> {
    const last = new Map<string, { date: string; amount: string }>();
    for (const [accountId, documents] of await this.documents(tx, tenantId, accountIds)) {
      const receipt = documents.receipts
        .filter((row) => !row.cancelled && row.date <= asOf)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (receipt) last.set(accountId, { date: receipt.date, amount: receipt.amount });
    }
    return last;
  }
}
