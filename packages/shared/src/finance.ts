/**
 * Account finance rules (spec 7.3, BR-20, BR-21) as pure functions: amounts are decimal strings,
 * summed exactly as paise, never through binary floating point.
 */
import { scaled, unscaled } from './pricing';

/** A band of days past due, from and to both included; the last band has no end. */
export interface AgeingBucket {
  key: string;
  fromDays: number;
  toDays: number | null;
}

/** M11's buckets when a tenant names none: 0–30, 31–60, 61–90, 91–180 and over 180 days. */
export const DEFAULT_AGEING_BUCKETS: readonly AgeingBucket[] = [
  { key: 'd0_30', fromDays: 0, toDays: 30 },
  { key: 'd31_60', fromDays: 31, toDays: 60 },
  { key: 'd61_90', fromDays: 61, toDays: 90 },
  { key: 'd91_180', fromDays: 91, toDays: 180 },
  { key: 'd181', fromDays: 181, toDays: null },
];

/** BR-20: buckets follow one another without overlapping; only the last may have no end. */
export function bucketsIssue(buckets: readonly AgeingBucket[]): string | null {
  for (const [index, bucket] of buckets.entries()) {
    if (bucket.toDays !== null && bucket.toDays < bucket.fromDays) {
      return `${bucket.key} ends before it starts`;
    }
    const next = buckets[index + 1];
    if (!next) continue;
    if (bucket.toDays === null) return `Only the last bucket may have no end, not ${bucket.key}`;
    if (next.fromDays <= bucket.toDays) return `${next.key} overlaps ${bucket.key}`;
  }
  return null;
}

/** BR-20: the ageing amounts may add up to more than outstanding by at most 0.01. */
export const AGEING_TOLERANCE = '0.01';

export function ageingIssue(
  outstanding: string,
  ageing: Readonly<Record<string, string>>,
): string | null {
  const sum = Object.values(ageing).reduce((total, amount) => total + scaled(amount, 2), 0n);
  const limit = scaled(outstanding, 2) + scaled(AGEING_TOLERANCE, 2);
  return sum > limit
    ? `The buckets add up to ${unscaled(sum, 2)}, more than the outstanding ${unscaled(scaled(outstanding, 2), 2)}`
    : null;
}

/** BR-21: one statement entry, a debit or a credit. */
export interface LedgerEntry {
  date: string;
  debit: string;
  credit: string;
}

/** BR-21: each entry has exactly one of debit or credit above zero. */
export function entryIssue(entry: Pick<LedgerEntry, 'debit' | 'credit'>): string | null {
  const debit = scaled(entry.debit, 2) > 0n;
  const credit = scaled(entry.credit, 2) > 0n;
  return debit === credit ? 'Fill in a debit or a credit, not both' : null;
}

/** A balance as a signed decimal string: debit less credit, owed when positive. */
function signed(value: bigint): string {
  return value < 0n ? `-${unscaled(-value, 2)}` : unscaled(value, 2);
}

/** BR-21: the opening balance of a period, Σ(debit − credit) of the entries dated before it. */
export function openingBalance(entries: readonly LedgerEntry[], from: string): string {
  return signed(
    entries
      .filter((entry) => entry.date < from)
      .reduce((total, entry) => total + scaled(entry.debit, 2) - scaled(entry.credit, 2), 0n),
  );
}

/** BR-21: the balance after each entry, from an opening balance, in the entries' order. */
export function runningBalances(opening: string, entries: readonly LedgerEntry[]): string[] {
  const negative = opening.startsWith('-');
  let balance = (negative ? -1n : 1n) * scaled(negative ? opening.slice(1) : opening, 2);
  return entries.map((entry) => {
    balance += scaled(entry.debit, 2) - scaled(entry.credit, 2);
    return signed(balance);
  });
}

/** BR-21: a statement lists at most this many entries; the closing balance counts them all. */
export const STATEMENT_LIMIT = 1000;

/**
 * The financial year containing a day, from the month it starts (spec 5.1): its first and last
 * days, and the year it starts in.
 */
export function financialYear(
  day: string,
  startMonth: number,
): { from: string; to: string; startYear: number } {
  const [year, month] = day.split('-').map(Number) as [number, number];
  const startYear = month >= startMonth ? year : year - 1;
  return financialYearOf(startYear, startMonth);
}

export function financialYearOf(
  startYear: number,
  startMonth: number,
): { from: string; to: string; startYear: number } {
  const from = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(startYear + 1, startMonth - 1, 0));
  return { from, to: end.toISOString().slice(0, 10), startYear };
}
