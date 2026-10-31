/**
 * Payroll inputs (spec M14, BR-26, decisions D14 and D117) as pure functions: the gross in force
 * for a month, and the provisional pay a month of attendance earns. Amounts are decimal strings,
 * exact as paise; this is an attendance-based estimate, never statutory payroll.
 */
import { scaled, unscaled } from './pricing';
import type { DayStatus } from './tracking';

/** A change of a person's monthly gross, in force from a month (`YYYY-MM`). */
export interface GrossChange {
  from: string;
  monthlyGross: string;
}

/** D117: the gross in force for a month, the latest change from that month or before; null without one. */
export function grossOn(changes: readonly GrossChange[], period: string): string | null {
  let found: GrossChange | null = null;
  for (const change of changes) {
    if (change.from <= period && (!found || change.from > found.from)) found = change;
  }
  return found?.monthlyGross ?? null;
}

/** A day as provisional pay counts it: its status and value (BR-23), and whether the calendar schedules it. */
export interface PayDay {
  status: DayStatus;
  value: number;
  /** Neither a holiday nor a weekly off on the person's calendar, employed or not. */
  working: boolean;
}

/**
 * BR-26 as decision D117 reads it: `round(gross × min(paid, scheduled) ÷ scheduled, 2)`, and 0
 * when nothing is scheduled. Scheduled days are the month's working days on the person's calendar,
 * whether they were employed then or the day is still to come, so a part month and the current
 * month earn a part; paid days are what the days so far are worth (BR-25).
 */
export function provisionalPay(
  gross: string,
  days: readonly PayDay[],
): { scheduled: number; paid: number; amount: string } {
  const scheduled = days.filter((day) => day.working).length;
  const halves = days.reduce((total, day) => total + Math.round(day.value * 2), 0);
  const paid = halves / 2;
  if (scheduled === 0) return { scheduled, paid, amount: '0.00' };
  const earned = BigInt(Math.min(halves, scheduled * 2));
  const denominator = BigInt(scheduled * 2);
  // Half up, to the paisa.
  const paise = (scaled(gross, 2) * earned * 2n + denominator) / (denominator * 2n);
  return { scheduled, paid, amount: unscaled(paise, 2) };
}

/** How many days of a month had each status, for the payslip and the summary. */
export function dayCounts(days: readonly { status: DayStatus }[]): Record<DayStatus, number> {
  const counts = {
    future: 0,
    not_employed: 0,
    present: 0,
    half_day: 0,
    paid_leave: 0,
    unpaid_leave: 0,
    holiday: 0,
    weekly_off: 0,
    absent: 0,
  } satisfies Record<DayStatus, number>;
  for (const day of days) counts[day.status] += 1;
  return counts;
}
