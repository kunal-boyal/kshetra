/**
 * Targets and account plans (spec 5.8, M8, BR-08): what a value may be for each kind of metric,
 * and who may unlock a locked target set. The server applies them; the web previews them.
 */

export const METRIC_UNITS = ['count', 'currency', 'quantity', 'percent', 'duration'] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

/** An unlock needs a reason this long or longer (BR-08). */
export const UNLOCK_REASON_MIN = 10;

/** The largest value a target or a plan holds. */
const MAX = 1_000_000_000_000;

/** How many decimals each kind of metric keeps: counts are whole, money has paise. */
const DECIMALS: Record<MetricUnit, number> = {
  count: 0,
  currency: 2,
  quantity: 3,
  percent: 2,
  duration: 2,
};

/**
 * What is wrong with a target or plan value for a metric of this unit, or null when it is fine:
 * a non-negative decimal number, whole for counts, with at most 2 decimals for money, percent and
 * durations and 3 for quantities.
 */
export function targetValueIssue(unit: MetricUnit, value: string): string | null {
  const text = value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return 'Enter a number of zero or more';
  const decimals = text.includes('.') ? text.split('.')[1]!.length : 0;
  const allowed = DECIMALS[unit];
  if (decimals > allowed) {
    return allowed === 0 ? 'Enter a whole number' : `Use at most ${allowed} decimals`;
  }
  if (Number(text) >= MAX) return 'This number is too large';
  return null;
}

/** BR-08: why a locked target set can't be unlocked by this person, or null when it can. */
export function unlockRefusal(input: {
  adminUnlock: boolean;
  holdsUnlock: boolean;
  reason: string;
}): 'NOT_ENABLED' | 'FORBIDDEN' | 'REASON_REQUIRED' | null {
  if (!input.adminUnlock) return 'NOT_ENABLED';
  if (!input.holdsUnlock) return 'FORBIDDEN';
  if (input.reason.trim().length < UNLOCK_REASON_MIN) return 'REASON_REQUIRED';
  return null;
}
