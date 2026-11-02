/**
 * Collections (module M11, BR-63, decision D132): the money a person takes from an account in the
 * field, which the office confirms. A collection stands beside the books and is never a receipt
 * of its own (spec 2.2): it is matched once the books' receipt for it arrives. Amounts are
 * decimal strings, exact as paise; dates are `YYYY-MM-DD` on the tenant's clock.
 */
import { type RegisterInvoice, type RegisterReceipt, settleInvoices } from './receivables';
import { scaled, unscaled } from './pricing';

export const COLLECTION_MODES = ['cash', 'upi', 'cheque', 'bank_transfer'] as const;
export type CollectionMode = (typeof COLLECTION_MODES)[number];

export const COLLECTION_STATUSES = [
  'recorded',
  'confirmed',
  'rejected',
  'bounced',
  'in_books',
] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

/**
 * Cash from one account on one day at or above this is refused: section 269ST of the Income-tax
 * Act forbids receiving ₹2 lakh or more in cash from a person in a day. The tenant's
 * `collectionCashLimit` setting, which null turns off.
 */
export const DEFAULT_COLLECTION_CASH_LIMIT = '200000.00';

/** How long after a collection the books' receipt for it may be dated and still match it. */
export const COLLECTION_MATCH_DAYS = 30;

/** A collection's number as people read it, from the tenant's counter (`COL-000123`). */
export function collectionNumber(number: number): string {
  return `COL-${String(number).padStart(6, '0')}`;
}

export interface CollectionIssue {
  path: string;
  issue:
    | 'amount'
    | 'future'
    | 'reference_needed'
    | 'cheque_number_needed'
    | 'cheque_bank_needed'
    | 'cheque_date_needed'
    | 'cheque_photo_needed'
    | 'over_cash_limit';
}

/**
 * BR-63: what refuses a collection, every problem in the order a person fixes them. A cheque
 * names its number, bank and date and comes with its photo; UPI and bank transfers name their
 * reference; cash needs none, but cash from the account on that day, this collection's included,
 * stays under the limit.
 */
export function collectionIssues(input: {
  amount: string;
  mode: CollectionMode;
  collectedOn: string;
  today: string;
  reference?: string | null | undefined;
  chequeNumber?: string | null | undefined;
  chequeBank?: string | null | undefined;
  chequeDate?: string | null | undefined;
  photos: number;
  /** Cash already recorded from the account that day, rejected collections left out. */
  cashThatDay: string;
  cashLimit: string | null;
}): CollectionIssue[] {
  const issues: CollectionIssue[] = [];
  const given = (value: string | null | undefined) => (value ?? '').trim() !== '';
  if (scaled(input.amount, 2) <= 0n) issues.push({ path: 'amount', issue: 'amount' });
  if (input.collectedOn > input.today) issues.push({ path: 'collectedOn', issue: 'future' });
  switch (input.mode) {
    case 'upi':
    case 'bank_transfer':
      if (!given(input.reference)) issues.push({ path: 'reference', issue: 'reference_needed' });
      break;
    case 'cheque':
      if (!given(input.chequeNumber)) {
        issues.push({ path: 'chequeNumber', issue: 'cheque_number_needed' });
      }
      if (!given(input.chequeBank))
        issues.push({ path: 'chequeBank', issue: 'cheque_bank_needed' });
      if (!given(input.chequeDate))
        issues.push({ path: 'chequeDate', issue: 'cheque_date_needed' });
      if (input.photos === 0) issues.push({ path: 'photos', issue: 'cheque_photo_needed' });
      break;
    case 'cash':
      if (
        input.cashLimit !== null &&
        scaled(input.cashThatDay, 2) + scaled(input.amount, 2) >= scaled(input.cashLimit, 2)
      ) {
        issues.push({ path: 'amount', issue: 'over_cash_limit' });
      }
      break;
  }
  return issues;
}

/** Where a collection may go next (BR-63), and what a decision needs. */
const MOVES: Record<CollectionStatus, readonly CollectionStatus[]> = {
  recorded: ['confirmed', 'rejected'],
  confirmed: ['bounced', 'in_books'],
  in_books: ['confirmed'],
  rejected: [],
  bounced: [],
};

export type CollectionMoveIssue = 'not_now' | 'own' | 'reason_needed' | 'not_cheque';

/**
 * BR-63: whether a collection may move from one status to another. Confirming, rejecting and
 * bouncing are the office's and never the collector's own; a rejection or a bounce gives its
 * reason; only a cheque bounces. Matching to the books and unmatching are by anyone who confirms.
 */
export function collectionMoveIssue(input: {
  from: CollectionStatus;
  to: CollectionStatus;
  mode: CollectionMode;
  own: boolean;
  reason?: string | null | undefined;
}): CollectionMoveIssue | null {
  if (!MOVES[input.from].includes(input.to)) return 'not_now';
  if (input.to === 'bounced' && input.mode !== 'cheque') return 'not_cheque';
  if (input.own && ['confirmed', 'rejected', 'bounced'].includes(input.to)) return 'own';
  if (['rejected', 'bounced'].includes(input.to) && (input.reason ?? '').trim() === '') {
    return 'reason_needed';
  }
  return null;
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

export interface MatchableCollection {
  id: string;
  accountId: string;
  amount: string;
  collectedOn: string;
  /** When it was recorded, which breaks ties between collections of one day. */
  recordedAt: string;
}

export interface MatchableReceipt {
  id: string;
  accountId: string;
  amount: string;
  date: string;
}

/**
 * BR-63: which of the books' receipts are which confirmed collections. Receipts, oldest first,
 * each take the oldest confirmed collection still unmatched at the same account for the same
 * amount, dated on the receipt's day or up to 30 days before it. One receipt matches one
 * collection; the caller passes only receipts and collections not yet matched.
 */
export function matchReceipts(
  collections: readonly MatchableCollection[],
  receipts: readonly MatchableReceipt[],
): { collectionId: string; receiptId: string }[] {
  const waiting = [...collections].sort(
    (a, b) =>
      a.collectedOn.localeCompare(b.collectedOn) ||
      a.recordedAt.localeCompare(b.recordedAt) ||
      a.id.localeCompare(b.id),
  );
  const taken = new Set<string>();
  const matches: { collectionId: string; receiptId: string }[] = [];
  const ordered = [...receipts].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  for (const receipt of ordered) {
    const amount = scaled(receipt.amount, 2);
    const found = waiting.find(
      (collection) =>
        !taken.has(collection.id) &&
        collection.accountId === receipt.accountId &&
        scaled(collection.amount, 2) === amount &&
        collection.collectedOn <= receipt.date &&
        dayNumber(receipt.date) - dayNumber(collection.collectedOn) <= COLLECTION_MATCH_DAYS,
    );
    if (!found) continue;
    taken.add(found.id);
    matches.push({ collectionId: found.id, receiptId: receipt.id });
  }
  return matches;
}

/**
 * BR-63: what an account's collections add to what the books say it owes. Collected but not yet
 * in the books is every collection recorded or confirmed; what is left is the outstanding less
 * that, never below zero.
 */
export function collectedNotInBooks(
  outstanding: string,
  collections: readonly { amount: string; status: CollectionStatus }[],
): { notInBooks: string; leftAfter: string } {
  const pending = collections
    .filter((collection) => collection.status === 'recorded' || collection.status === 'confirmed')
    .reduce((sum, collection) => sum + scaled(collection.amount, 2), 0n);
  const left = scaled(outstanding, 2) - pending;
  return { notInBooks: unscaled(pending, 2), leftAfter: unscaled(left > 0n ? left : 0n, 2) };
}

/**
 * BR-63: which open invoices a new collection would settle, oldest first, after what the books'
 * receipts and the account's collections not yet in the books settle. A preview, never stored.
 */
export function collectionPreview(input: {
  invoices: readonly RegisterInvoice[];
  receipts: readonly RegisterReceipt[];
  /** Collections recorded or confirmed and not yet in the books, as they would settle first. */
  pending: readonly { amount: string; collectedOn: string }[];
  amount: string;
}): { settles: { invoice: string; amount: string }[]; advance: string } {
  const NEW = '\u0000collection';
  const settled = settleInvoices(input.invoices, [
    ...input.receipts,
    ...input.pending.map((collection, index) => ({
      number: `\u0000pending${String(index).padStart(6, '0')}`,
      date: collection.collectedOn,
      amount: collection.amount,
      against: [],
      cancelled: false,
    })),
    // Last of all, after every receipt and collection the books or the office hold.
    { number: NEW, date: '9999-12-31', amount: input.amount, against: [], cancelled: false },
  ]);
  const settles = settled.settlements
    .filter((settlement) => settlement.receipt === NEW)
    .map((settlement) => ({ invoice: settlement.invoice, amount: settlement.amount }));
  const used = settles.reduce((sum, entry) => sum + scaled(entry.amount, 2), 0n);
  return { settles, advance: unscaled(scaled(input.amount, 2) - used, 2) };
}
