/**
 * Invoices and receipts from the customer's books (M11, BR-51, decision D121): which invoices
 * are still open, and the outstanding and ageing they make. Amounts are decimal strings, settled
 * exactly as paise; dates are `YYYY-MM-DD`. The product keeps no ledger of its own (spec 2.2).
 */
import type { AgeingBucket } from './finance';
import { scaled, unscaled } from './pricing';

/** The credit days an invoice gets when neither it nor its file gives a due date (D121). */
export const DEFAULT_CREDIT_DAYS = 30;

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** An invoice's due date: its date plus its credit days (BR-51). */
export function invoiceDueDate(date: string, creditDays: number): string {
  return new Date((dayNumber(date) + creditDays) * DAY_MS).toISOString().slice(0, 10);
}

export interface RegisterInvoice {
  number: string;
  date: string;
  dueDate: string;
  amount: string;
  cancelled: boolean;
}

export interface RegisterReceipt {
  number: string;
  date: string;
  amount: string;
  /** The invoice numbers it pays, in the order named. */
  against: readonly string[];
  cancelled: boolean;
}

/** How a receipt settled an invoice. */
export interface Settlement {
  receipt: string;
  invoice: string;
  amount: string;
}

/** What settling leaves: each live invoice's open amount, and receipts beyond every invoice. */
export interface Settled {
  /** Open amount by invoice number, for every invoice not cancelled. */
  open: Map<string, string>;
  settlements: Settlement[];
  /** Receipts left over once every invoice is paid: an advance. */
  advance: string;
}

/**
 * BR-51: receipts, oldest first, settle the invoices they name, in the order named, as far as
 * each is open; what a receipt leaves settles the account's oldest open invoices, by due date,
 * then date, then number. Cancelled invoices and receipts take no part.
 */
export function settleInvoices(
  invoices: readonly RegisterInvoice[],
  receipts: readonly RegisterReceipt[],
): Settled {
  const live = invoices
    .filter((invoice) => !invoice.cancelled)
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        a.date.localeCompare(b.date) ||
        a.number.localeCompare(b.number),
    );
  const open = new Map(live.map((invoice) => [invoice.number, scaled(invoice.amount, 2)]));
  const settlements: Settlement[] = [];
  let advance = 0n;
  const pay = (receipt: string, invoice: string, left: bigint): bigint => {
    const due = open.get(invoice) ?? 0n;
    const amount = due < left ? due : left;
    if (amount <= 0n) return left;
    open.set(invoice, due - amount);
    settlements.push({ receipt, invoice, amount: unscaled(amount, 2) });
    return left - amount;
  };
  const ordered = receipts
    .filter((receipt) => !receipt.cancelled)
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  for (const receipt of ordered) {
    let left = scaled(receipt.amount, 2);
    for (const number of receipt.against) left = pay(receipt.number, number, left);
    for (const invoice of live) {
      if (left === 0n) break;
      left = pay(receipt.number, invoice.number, left);
    }
    advance += left;
  }
  return {
    open: new Map([...open].map(([number, amount]) => [number, unscaled(amount, 2)])),
    settlements,
    advance: unscaled(advance, 2),
  };
}

/** An account's receivables on a day (BR-51). */
export interface Receivables {
  /** Open invoices less any advance; negative when the advance is larger. */
  outstanding: string;
  notDue: string;
  overdue: string;
  /** Overdue amounts by the tenant's buckets of days past due (BR-20). */
  ageing: Record<string, string>;
  /** The earliest due date among open overdue invoices, or null. */
  oldestDue: string | null;
  advance: string;
}

/**
 * BR-51: the open invoices on `asOf`: not yet due when due after it, otherwise overdue and aged
 * by days past due into the tenant's buckets. Outstanding is what is open less any advance.
 */
export function invoiceAgeing(
  invoices: readonly RegisterInvoice[],
  settled: Settled,
  buckets: readonly AgeingBucket[],
  asOf: string,
): Receivables {
  const ageing = Object.fromEntries(buckets.map((bucket) => [bucket.key, 0n]));
  let notDue = 0n;
  let overdue = 0n;
  let oldestDue: string | null = null;
  for (const invoice of invoices) {
    const amount = scaled(settled.open.get(invoice.number) ?? '0', 2);
    if (invoice.cancelled || amount === 0n) continue;
    const late = dayNumber(asOf) - dayNumber(invoice.dueDate);
    if (late < 0) {
      notDue += amount;
      continue;
    }
    overdue += amount;
    if (oldestDue === null || invoice.dueDate < oldestDue) oldestDue = invoice.dueDate;
    const bucket = buckets.find(
      (entry) => late >= entry.fromDays && (entry.toDays === null || late <= entry.toDays),
    );
    if (bucket) ageing[bucket.key]! += amount;
  }
  const advance = scaled(settled.advance, 2);
  const outstanding = notDue + overdue - advance;
  return {
    outstanding: outstanding < 0n ? `-${unscaled(-outstanding, 2)}` : unscaled(outstanding, 2),
    notDue: unscaled(notDue, 2),
    overdue: unscaled(overdue, 2),
    ageing: Object.fromEntries(
      Object.entries(ageing).map(([key, amount]) => [key, unscaled(amount, 2)]),
    ),
    oldestDue,
    advance: unscaled(advance, 2),
  };
}
