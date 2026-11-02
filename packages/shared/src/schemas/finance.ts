import { z } from 'zod';
import { Key, Money } from './config';

/**
 * Account finance (M11, spec 7.3, decision D79): what an account owed on a day, with its ageing,
 * from the customer's accounts software or back office, and its statement of debits and credits.
 */

const CalendarDate = z.iso.date();

/** `POST /v1/finance-snapshots`: an account's balance on a day, with its own ID. */
export const FinanceSnapshotBody = z
  .strictObject({
    id: z.uuid(),
    accountId: z.uuid(),
    /** Not in the future (BR-20). */
    asOf: CalendarDate,
    outstanding: Money,
    creditLimit: Money.nullable().default(null),
    inventoryValue: Money.nullable().default(null),
    /** Amount past due by the tenant's ageing buckets, by bucket key. */
    ageing: z.record(Key, Money).default({}),
    /** Where it came from, such as the accounts software\'s name or "back office". */
    source: z.string().trim().min(1).max(60),
  })
  .meta({ id: 'FinanceSnapshotBody' });

export const FinanceSnapshot = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    asOf: CalendarDate,
    outstanding: z.string(),
    creditLimit: z.string().nullable(),
    inventoryValue: z.string().nullable(),
    ageing: z.record(z.string(), z.string()),
    source: z.string(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'FinanceSnapshot' });

/**
 * `POST /v1/ledger-entries`: statement entries, append-only (BR-21). An entry's reference is its
 * key: sending one again unchanged changes nothing, and changed is refused; a correction is a
 * reversing entry.
 */
export const LedgerEntriesBody = z
  .strictObject({
    entries: z
      .array(
        z.strictObject({
          id: z.uuid(),
          accountId: z.uuid(),
          date: CalendarDate,
          reference: z.string().trim().min(1).max(60),
          description: z.string().trim().max(200).nullable().default(null),
          debit: Money.default('0'),
          credit: Money.default('0'),
        }),
      )
      .min(1)
      .max(500),
  })
  .meta({ id: 'LedgerEntriesBody' });

export const LedgerEntriesResult = z.object({
  /** Entries added now; those sent again unchanged are left as they were. */
  created: z.int().min(0),
  unchanged: z.int().min(0),
});

/** `GET /v1/accounts/{id}/finance`: the latest snapshot and the ones before it. */
/** An account's receivables from its invoices on a day (BR-51, decision D121). */
export const Receivables = z
  .object({
    asOf: CalendarDate,
    /** Open invoices less any advance; negative when the advance is larger. */
    outstanding: z.string(),
    notDue: z.string(),
    overdue: z.string(),
    ageing: z.record(Key, z.string()),
    oldestDue: CalendarDate.nullable(),
    advance: z.string(),
    /** The credit limit of the latest snapshot, if any. */
    creditLimit: z.string().nullable(),
  })
  .meta({ id: 'Receivables' });

export const AccountFinanceResult = z.object({
  latest: FinanceSnapshot.nullable(),
  history: z.array(FinanceSnapshot),
  /** Worked out from the account's invoices once it has any (D121); null otherwise. */
  receivables: Receivables.nullable(),
  /**
   * The field's collections not yet in the books (BR-63, D132), and what the account owes after
   * them: from its invoices, else its latest balance; null `leftAfter` without either.
   */
  collected: z.object({ notInBooks: z.string(), leftAfter: z.string().nullable() }),
});

/** `GET /v1/accounts/{id}/invoices`: open ones, or every one, newest due date first. */
export const AccountInvoiceQuery = z.strictObject({
  status: z.enum(['open', 'all']).default('open'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

export const AccountInvoiceRow = z.object({
  id: z.uuid(),
  number: z.string(),
  date: CalendarDate,
  dueDate: CalendarDate,
  amount: z.string(),
  /** What is still to be paid (BR-51); 0.00 when settled or cancelled. */
  open: z.string(),
  /** Days past due today, or null while not due or once settled. */
  daysPastDue: z.int().nullable(),
  cancelled: z.boolean(),
  /** The receipts that settled it, with how much each. */
  settledBy: z.array(z.object({ receipt: z.string(), amount: z.string() })),
});

export const AccountInvoiceListResult = z.object({
  items: z.array(AccountInvoiceRow),
  nextCursor: z.string().nullable(),
});

/** `GET /v1/accounts/{id}/receipts`: newest first. */
export const AccountReceiptQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

export const RECEIPT_KINDS = ['receipt', 'credit_note'] as const;

export const AccountReceiptRow = z.object({
  id: z.uuid(),
  number: z.string(),
  date: CalendarDate,
  amount: z.string(),
  kind: z.enum(RECEIPT_KINDS),
  against: z.array(z.string()),
  cancelled: z.boolean(),
  /** The invoices it settled, with how much each. */
  settled: z.array(z.object({ invoice: z.string(), amount: z.string() })),
});

export const AccountReceiptListResult = z.object({
  items: z.array(AccountReceiptRow),
  nextCursor: z.string().nullable(),
});

export const StatementQuery = z.strictObject({
  /** The year a financial year starts in; the current one when left out. */
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

/** `GET /v1/accounts/{id}/statement`: one financial year with running balances (BR-21). */
export const StatementResult = z.object({
  from: CalendarDate,
  to: CalendarDate,
  /** Debit less credit: owed when positive. */
  opening: z.string(),
  closing: z.string(),
  entries: z.array(
    z.object({
      id: z.uuid(),
      date: CalendarDate,
      reference: z.string(),
      description: z.string().nullable(),
      debit: z.string(),
      credit: z.string(),
      balance: z.string(),
    }),
  ),
  /** More entries exist than are listed; the closing balance still counts them all. */
  truncated: z.boolean(),
  count: z.int().min(0),
});

export type FinanceSnapshotBody = z.output<typeof FinanceSnapshotBody>;
export type FinanceSnapshot = z.infer<typeof FinanceSnapshot>;
export type LedgerEntriesBody = z.output<typeof LedgerEntriesBody>;
export type LedgerEntriesResult = z.infer<typeof LedgerEntriesResult>;
export type AccountFinanceResult = z.infer<typeof AccountFinanceResult>;
export type ReceivablesResult = z.infer<typeof Receivables>;
export type AccountInvoiceQuery = z.output<typeof AccountInvoiceQuery>;
export type AccountInvoiceRow = z.infer<typeof AccountInvoiceRow>;
export type AccountInvoiceListResult = z.infer<typeof AccountInvoiceListResult>;
export type AccountReceiptQuery = z.output<typeof AccountReceiptQuery>;
export type AccountReceiptRow = z.infer<typeof AccountReceiptRow>;
export type AccountReceiptListResult = z.infer<typeof AccountReceiptListResult>;
export type StatementQuery = z.output<typeof StatementQuery>;
export type StatementResult = z.infer<typeof StatementResult>;
