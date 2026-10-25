import { scaled, unscaled } from './pricing';

/**
 * Plans, seats and usage (module M23, BR-45, decision D89). Pure rules: the server counts with
 * them, and the console and billing show what they say.
 */

/** What the directory meters for each tenant and month (M22). */
export const USAGE_METRICS = [
  'seats',
  'active_users',
  'storage_bytes',
  'sms',
  'whatsapp',
  'api_calls',
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

/** A person's active time, as calendar dates on the tenant's clock; `to` is null while active. */
export interface SeatInterval {
  userId: string;
  from: string;
  to: string | null;
}

export interface BillableSeats {
  /** Distinct people active at any moment in the period. */
  seats: number;
  /** Seats as billed on a monthly plan, with mid-period starts prorated by day, to 4 places. */
  units: string;
  byUser: { userId: string; share: string }[];
}

function days(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

/**
 * BR-45: billable seats for a period (`start` to `end`, both inclusive) are the distinct people
 * active at any moment in it. Someone active when the period starts counts in full, however
 * early they leave; someone who starts during it counts from their first day, by day, on a
 * monthly plan (`prorate`), and in full otherwise.
 */
export function billableSeats(
  intervals: readonly SeatInterval[],
  start: string,
  end: string,
  prorate = true,
): BillableSeats {
  const length = days(start, end);
  const firstDay = new Map<string, string>();
  for (const interval of intervals) {
    if (interval.from > end || (interval.to !== null && interval.to < start)) continue;
    const first = interval.from < start ? start : interval.from;
    const known = firstDay.get(interval.userId);
    if (!known || first < known) firstDay.set(interval.userId, first);
  }
  const byUser = [...firstDay].map(([userId, first]) => {
    const share =
      !prorate || first === start
        ? 10_000n
        : (BigInt(days(first, end)) * 10_000n + BigInt(length) / 2n) / BigInt(length);
    return { userId, share: unscaled(share, 4) };
  });
  const units = byUser.reduce((sum, user) => sum + scaled(user.share, 4), 0n);
  return { seats: byUser.length, units: unscaled(units, 4), byUser };
}

/** The first and last day of a `YYYY-MM` period. */
export function periodDays(period: string): { start: string; end: string } {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(last).padStart(2, '0')}` };
}
