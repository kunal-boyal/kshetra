/**
 * Expense rules (spec M12, BR-29, BR-30) as pure functions: what a policy pays for a claim, the
 * caps that bound it, what refuses a claim, and when a receipt holds up its approval. Amounts are
 * decimal strings, exact as paise; the server is authoritative and the apps preview with these.
 */
import { type ErrorDetail, issueAt } from './errors';
import { scaled, unscaled } from './pricing';

export const EXPENSE_CATEGORIES = ['travel', 'daily_allowance', 'other'] as const;
export const EXPENSE_CALCULATIONS = ['per_km', 'per_day', 'per_visit', 'actual'] as const;
export type ExpenseCalculation = (typeof EXPENSE_CALCULATIONS)[number];

/** Where a per-km policy takes its kilometres from (decision D115). */
export const KM_SOURCES = ['odometer', 'tracked'] as const;
export type KmSource = (typeof KM_SOURCES)[number];

/** A claim's description runs from 3 to 300 characters. */
export const EXPENSE_DESCRIPTION = { min: 3, max: 300 } as const;

/** A flat rate, or a rate for each designation. */
export type ExpenseRateRule = { flat: string } | { byDesignation: Record<string, string> };

/** What a policy says about claims under it (spec 5.10). */
export interface ExpensePolicyRule {
  calculation: ExpenseCalculation;
  /** Per-km policies: odometer readings (when left out) or the day's tracked distance. */
  kmFrom?: KmSource | undefined;
  rate?: ExpenseRateRule | undefined;
  caps: {
    perClaim?: string | undefined;
    perDay?: string | undefined;
    perMonth?: string | undefined;
  };
  receiptRequired: boolean;
  odometerPhotosRequired: boolean;
  active: boolean;
}

/** The rate a person's designation is paid under a policy, or null when it names none for them. */
export function rateFor(rate: ExpenseRateRule | undefined, designation: string): string | null {
  if (!rate) return null;
  if ('flat' in rate) return rate.flat;
  return rate.byDesignation[designation] ?? null;
}

const money = (text: string) => scaled(text, 2);
const show = (paise: bigint) => unscaled(paise, 2);

/** BR-29: the distance between odometer readings, `round(closing − opening, 2)`. */
export function odometerDistance(opening: string, closing: string): string {
  return unscaled(scaled(closing, 2) - scaled(opening, 2), 2);
}

/** Decision D115: tracked metres as kilometres to 2 places, half up, as BR-29 rounds readings. */
export function trackedKm(distanceM: number): string {
  const metres = BigInt(Math.max(0, Math.round(distanceM)));
  return unscaled((metres + 5n) / 10n, 2);
}

/**
 * Decision D115: when a claim's odometer and tracked kilometres differ by more than 10% of the
 * larger figure and at least 2 km, which approvers are shown.
 */
export const DISTANCE_GAP = { share: 10, minKm: '2' } as const;

/** Decision D115: whether odometer and tracked kilometres are far enough apart to flag. */
export function distanceGap(odometerKm: string, trackedKmText: string): boolean {
  const a = scaled(odometerKm, 2);
  const b = scaled(trackedKmText, 2);
  const gap = a > b ? a - b : b - a;
  const larger = a > b ? a : b;
  return gap * 100n > larger * BigInt(DISTANCE_GAP.share) && gap >= scaled(DISTANCE_GAP.minKm, 2);
}

/** `quantity × rate`, rounded half-up to paise. */
function times(quantity: string, rate: string): bigint {
  const product = scaled(quantity, 3) * money(rate);
  return (product * 2n + 1000n) / 2000n;
}

/**
 * BR-29: what a claim comes to before caps. Per km pays the odometer distance, or the day's
 * tracked distance where the policy takes it from there (D115), per day the days, per visit the
 * visits completed that day, each at the rate; actual pays the bill.
 */
export function claimBase(input: {
  calculation: ExpenseCalculation;
  kmFrom?: KmSource | undefined;
  trackedKm?: string | null | undefined;
  rate: string | null;
  odometerOpen?: string | undefined;
  odometerClose?: string | undefined;
  days?: string | undefined;
  visits?: number | undefined;
  billAmount?: string | undefined;
}): { quantity: string | null; amount: string } {
  switch (input.calculation) {
    case 'per_km': {
      const quantity =
        input.kmFrom === 'tracked'
          ? (input.trackedKm ?? '0.00')
          : odometerDistance(input.odometerOpen ?? '0', input.odometerClose ?? '0');
      const amount = input.rate && !quantity.startsWith('-') ? times(quantity, input.rate) : 0n;
      return { quantity, amount: show(amount < 0n ? 0n : amount) };
    }
    case 'per_day': {
      const quantity = input.days ?? '0';
      return { quantity, amount: show(input.rate ? times(quantity, input.rate) : 0n) };
    }
    case 'per_visit': {
      const quantity = String(input.visits ?? 0);
      return { quantity, amount: show(input.rate ? times(quantity, input.rate) : 0n) };
    }
    case 'actual':
      return { quantity: null, amount: show(money(input.billAmount ?? '0')) };
  }
}

/**
 * BR-29: the caps, the per-claim cap first, then what is left of the per-day and per-month caps
 * after the person's other waiting and approved claims under the policy.
 */
export function capClaim(
  amount: string,
  caps: ExpensePolicyRule['caps'],
  used: { day: string; month: string },
): { amount: string; capped: boolean } {
  const asked = money(amount);
  let paid = asked;
  if (caps.perClaim !== undefined && paid > money(caps.perClaim)) paid = money(caps.perClaim);
  const left = (cap: string | undefined, spent: string) =>
    cap === undefined ? null : money(cap) - money(spent);
  for (const room of [left(caps.perDay, used.day), left(caps.perMonth, used.month)]) {
    if (room !== null && paid > room) paid = room > 0n ? room : 0n;
  }
  return { amount: show(paid), capped: paid < asked };
}

/** Why a claim is refused, with the field it concerns. */
export interface ExpenseIssue {
  path:
    | 'policy'
    | 'expenseDate'
    | 'days'
    | 'odometerOpen'
    | 'odometerClose'
    | 'odometerPhotoIds'
    | 'billAmount';
  issue:
    | 'inactive_policy'
    | 'no_rate'
    | 'future'
    | 'days_needed'
    | 'readings_needed'
    | 'closing_before_opening'
    | 'odometer_photos'
    | 'tracked_needed'
    | 'nothing_tracked'
    | 'bill_needed'
    | 'no_visits'
    | 'nothing_left';
}

/**
 * BR-29: what refuses a claim, every problem in the order a person fixes them. `amount` is the
 * claim after caps.
 */
export function claimIssues(input: {
  policy: ExpensePolicyRule;
  rate: string | null;
  expenseDate: string;
  today: string;
  days?: string | undefined;
  odometerOpen?: string | undefined;
  odometerClose?: string | undefined;
  odometerPhotos: number;
  /** Tracked policies: the day's tracked kilometres, null without an ended shift that day. */
  trackedKm?: string | null | undefined;
  billAmount?: string | undefined;
  visits?: number | undefined;
  amount: string;
}): ExpenseIssue[] {
  const issues: ExpenseIssue[] = [];
  const { policy } = input;
  if (!policy.active) issues.push({ path: 'policy', issue: 'inactive_policy' });
  if (policy.calculation !== 'actual' && input.rate === null) {
    issues.push({ path: 'policy', issue: 'no_rate' });
  }
  if (input.expenseDate > input.today) issues.push({ path: 'expenseDate', issue: 'future' });
  switch (policy.calculation) {
    case 'per_km':
      if (policy.kmFrom === 'tracked') {
        if (input.trackedKm == null) issues.push({ path: 'expenseDate', issue: 'tracked_needed' });
        else if (scaled(input.trackedKm, 2) === 0n) {
          issues.push({ path: 'expenseDate', issue: 'nothing_tracked' });
        }
      } else if (input.odometerOpen === undefined || input.odometerClose === undefined) {
        issues.push({ path: 'odometerOpen', issue: 'readings_needed' });
      }
      if (
        input.odometerOpen !== undefined &&
        input.odometerClose !== undefined &&
        scaled(input.odometerClose, 2) < scaled(input.odometerOpen, 2)
      ) {
        issues.push({ path: 'odometerClose', issue: 'closing_before_opening' });
      }
      if (policy.odometerPhotosRequired && input.odometerPhotos < 2) {
        issues.push({ path: 'odometerPhotoIds', issue: 'odometer_photos' });
      }
      break;
    case 'per_day':
      if (input.days === undefined || scaled(input.days, 3) === 0n) {
        issues.push({ path: 'days', issue: 'days_needed' });
      }
      break;
    case 'per_visit':
      if (!input.visits) issues.push({ path: 'expenseDate', issue: 'no_visits' });
      break;
    case 'actual':
      if (input.billAmount === undefined || money(input.billAmount) === 0n) {
        issues.push({ path: 'billAmount', issue: 'bill_needed' });
      }
      break;
  }
  if (issues.length === 0 && money(input.amount) === 0n) {
    issues.push({ path: 'policy', issue: 'nothing_left' });
  }
  return issues;
}

/** BR-30: a claim under a policy that needs receipts passes no approval step without one. */
export function receiptHoldsApproval(
  policy: Pick<ExpensePolicyRule, 'receiptRequired'>,
  receipts: number,
): boolean {
  return policy.receiptRequired && receipts === 0;
}

/** Checks a policy's settings agree: a rate where it pays one, known designations, real amounts. */
export function expensePolicyIssues(
  policy: ExpensePolicyRule,
  designations: ReadonlySet<string>,
  path: readonly PropertyKey[],
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const at = (rest: readonly PropertyKey[], issue: string) =>
    issues.push(issueAt([...path, ...rest], issue));
  const positive = (amount: string, rest: readonly PropertyKey[]) => {
    if (money(amount) === 0n) at(rest, 'Use an amount above zero');
  };

  if (policy.calculation === 'actual') {
    if (policy.rate) at(['rate'], 'A claim of the bill amount takes no rate');
  } else if (!policy.rate) {
    at(['rate'], `A ${policy.calculation} policy needs a rate`);
  } else if ('flat' in policy.rate) {
    positive(policy.rate.flat, ['rate', 'flat']);
  } else {
    const rates = Object.entries(policy.rate.byDesignation);
    if (rates.length === 0) {
      at(['rate', 'byDesignation'], 'Give a rate for at least one designation');
    }
    for (const [designation, amount] of rates) {
      if (!designations.has(designation)) {
        at(['rate', 'byDesignation', designation], `There is no designation \`${designation}\``);
      }
      positive(amount, ['rate', 'byDesignation', designation]);
    }
  }
  for (const [cap, amount] of Object.entries(policy.caps)) {
    if (amount !== undefined) positive(amount, ['caps', cap]);
  }
  if (policy.odometerPhotosRequired && policy.calculation !== 'per_km') {
    at(['odometerPhotosRequired'], 'Odometer photos apply to per-km claims only');
  }
  if (policy.kmFrom !== undefined && policy.calculation !== 'per_km') {
    at(['kmFrom'], 'Where kilometres come from applies to per-km claims only');
  }
  return issues;
}
