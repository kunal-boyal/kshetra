import { financialYear } from './finance';
import { scaled, unscaled } from './pricing';

/**
 * Invoicing, dunning and licences (module M23, BR-47 to BR-49, decision D90). Pure rules: the
 * billing module issues invoices and moves tenants with them, and the console and the portal show
 * what they say. Amounts are decimal strings, computed exactly in paise.
 */

/** The vendor's clock: billing days, invoice dates and dunning days are days in India. */
export const BILLING_TIME_ZONE = 'Asia/Kolkata';

export const BILLING_CYCLES = ['month', 'year'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const INVOICE_KINDS = ['monthly', 'annual', 'true_up'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_STATUSES = ['issued', 'paid'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Days into a month before its seats are invoiced: metering measures a month again for its first
 * three days after it ends, so people whose changes arrive late are counted (D89).
 */
export const SEAT_SETTLE_DAYS = 3;

/** How long a dedicated install keeps working after its licence expires (spec M23). */
export const LICENCE_GRACE_DAYS = 30;

/** India's GST state codes, as the first two digits of a GSTIN and on invoices. */
export const GST_STATES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

const GSTIN = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** What is wrong with a GSTIN, or null: its shape, its state, and its check character. */
export function gstinIssue(gstin: string, stateCode?: string): string | null {
  const match = GSTIN.exec(gstin);
  if (!match) return 'Enter the 15-character GSTIN';
  if (!GST_STATES[match[1]!]) return 'The GSTIN starts with a state code that does not exist';
  if (stateCode && match[1] !== stateCode) return 'The GSTIN is for another state';
  let sum = 0;
  for (let index = 0; index < 14; index++) {
    const product = GSTIN_CHARS.indexOf(gstin[index]!) * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  if (GSTIN_CHARS[(36 - (sum % 36)) % 36] !== gstin[14])
    return 'Check the GSTIN for a typing error';
  return null;
}

/** `numerator / denominator`, rounded half-up; both non-negative. */
function divide(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** A line's amount: a quantity to 4 places at a rate in rupees, rounded half-up to the paisa. */
export function lineAmount(quantity: string, rate: string): string {
  return unscaled(divide(scaled(quantity, 4) * scaled(rate, 2), 10_000n), 2);
}

export interface GstAmounts {
  cgst: string;
  sgst: string;
  igst: string;
  tax: string;
  total: string;
}

/**
 * BR-47: GST on the vendor's invoice. Supply within the seller's state carries CGST and SGST at
 * half the rate each; supply to another state, or to a buyer with no state, carries IGST at the
 * full rate. Each tax is rounded half-up to the paisa on the subtotal.
 */
export function gstOn(
  subtotal: string,
  rate: string,
  sellerState: string,
  buyerState: string | null,
): GstAmounts {
  const base = scaled(subtotal, 2);
  const percent = scaled(rate, 2);
  const zero = 0n;
  let cgst = zero;
  let sgst = zero;
  let igst = zero;
  if (buyerState === sellerState) {
    cgst = divide(base * percent, 20_000n);
    sgst = cgst;
  } else {
    igst = divide(base * percent, 10_000n);
  }
  const tax = cgst + sgst + igst;
  return {
    cgst: unscaled(cgst, 2),
    sgst: unscaled(sgst, 2),
    igst: unscaled(igst, 2),
    tax: unscaled(tax, 2),
    total: unscaled(base + tax, 2),
  };
}

/** The sum of some amounts, exactly. */
export function sumAmounts(amounts: readonly string[]): string {
  return unscaled(
    amounts.reduce((sum, amount) => sum + scaled(amount, 2), 0n),
    2,
  );
}

/**
 * An invoice's series and number (BR-47): one gapless series a financial year, April to March, as
 * GST asks, such as `TL/26-27/00042`; at most 16 characters with a prefix of up to 4.
 */
export function invoiceSeries(prefix: string, day: string): string {
  const { startYear } = financialYear(day, 4);
  const short = (year: number) => String(year % 100).padStart(2, '0');
  return `${prefix}/${short(startYear)}-${short(startYear + 1)}`;
}

export function invoiceNumber(series: string, sequence: number): string {
  return `${series}/${String(sequence).padStart(5, '0')}`;
}

/** A calendar day `n` days after `day` (negative for before). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** A calendar day `n` months after `day`, kept to the month's last day when it is shorter. */
export function addMonths(day: string, n: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(year, month - 1 + n + 1, 0)).getUTCDate();
  const shifted = new Date(Date.UTC(year, month - 1 + n, Math.min(date, last)));
  return shifted.toISOString().slice(0, 10);
}

/** The whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** An annual term from its first day: twelve months, ending the day before the next begins. */
export function annualTerm(start: string): { from: string; to: string } {
  return { from: start, to: addDays(addMonths(start, 12), -1) };
}

/** The four quarters of an annual term, for its true-ups (BR-47). */
export function termQuarters(start: string): { quarter: number; from: string; to: string }[] {
  return [1, 2, 3, 4].map((quarter) => ({
    quarter,
    from: addMonths(start, 3 * (quarter - 1)),
    to: addDays(addMonths(start, 3 * quarter), -1),
  }));
}

export interface TrueUp {
  /** Seats above the commitment, billed now and added to it for the rest of the term. */
  extra: number;
  /** Months billed: from the quarter's start to the term's end. */
  months: number;
  /** A seat's price for those months, to the paisa, so the line multiplies out exactly. */
  rate: string;
  amount: string;
}

/**
 * BR-47: the quarterly true-up of an annual subscription. Seats in a quarter are the distinct
 * people active in it (BR-45, not prorated); those above the commitment are billed at the annual
 * price for the months from the quarter's start to the term's end, a seat's share rounded to the
 * paisa, and join the commitment.
 */
export function trueUp(input: {
  committed: number;
  seats: number;
  priceYear: string;
  quarter: number;
}): TrueUp {
  const extra = Math.max(0, input.seats - input.committed);
  const months = 12 - 3 * (input.quarter - 1);
  const rate = divide(scaled(input.priceYear, 2) * BigInt(months), 12n);
  return { extra, months, rate: unscaled(rate, 2), amount: unscaled(rate * BigInt(extra), 2) };
}

export type DunningStatus = 'grace' | 'read_only' | 'suspended';

export interface Dunning {
  status: DunningStatus;
  readOnlyOn: string;
  suspendOn: string;
}

/**
 * BR-48: where an unpaid tenant stands. From the day a payment failed or an invoice fell due
 * unpaid, it has `graceDays` of grace, then `readOnlyDays` read only, then it is suspended.
 */
export function dunning(input: {
  overdueSince: string;
  today: string;
  graceDays: number;
  readOnlyDays: number;
}): Dunning {
  const readOnlyOn = addDays(input.overdueSince, input.graceDays);
  const suspendOn = addDays(readOnlyOn, input.readOnlyDays);
  const status: DunningStatus =
    input.today < readOnlyOn ? 'grace' : input.today < suspendOn ? 'read_only' : 'suspended';
  return { status, readOnlyOn, suspendOn };
}

export const DUNNING_NOTICES = [
  'payment_overdue',
  'payment_reminder',
  'read_only',
  'suspension_soon',
  'suspended',
] as const;
export type DunningNotice = (typeof DUNNING_NOTICES)[number];

/**
 * BR-48: the emails an unpaid tenant's billing contact receives, by days since it fell overdue:
 * at once, then on days 3 and 6 of grace while grace lasts, when it turns read only, three days
 * before suspension, and on suspension. Each goes once (its key names it).
 */
export function dunningNotices(
  graceDays: number,
  readOnlyDays: number,
): { key: string; notice: DunningNotice; day: number }[] {
  const notices: { key: string; notice: DunningNotice; day: number }[] = [
    { key: 'overdue', notice: 'payment_overdue', day: 0 },
  ];
  for (const day of [3, 6]) {
    if (day < graceDays) notices.push({ key: `reminder_${day}`, notice: 'payment_reminder', day });
  }
  notices.push({ key: 'read_only', notice: 'read_only', day: graceDays });
  const soon = graceDays + readOnlyDays - 3;
  if (soon > graceDays)
    notices.push({ key: 'suspension_soon', notice: 'suspension_soon', day: soon });
  notices.push({ key: 'suspended', notice: 'suspended', day: graceDays + readOnlyDays });
  return notices;
}

/** Days before a trial ends when its admins are reminded to subscribe. */
export const TRIAL_REMINDER_DAYS = [7, 1] as const;

export type LicenceState = 'valid' | 'grace' | 'expired';

/**
 * BR-49: a licence's state on a day. It is valid to its expiry, in grace for
 * `LICENCE_GRACE_DAYS` after, then expired, when the install turns read only.
 */
export function licenceState(
  expiresOn: string,
  today: string,
): { state: LicenceState; graceEndsOn: string } {
  const graceEndsOn = addDays(expiresOn, LICENCE_GRACE_DAYS);
  const state: LicenceState =
    today <= expiresOn ? 'valid' : today <= graceEndsOn ? 'grace' : 'expired';
  return { state, graceEndsOn };
}
