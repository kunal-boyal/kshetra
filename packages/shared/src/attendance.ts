/**
 * Attendance rules beyond a single day (spec M13, BR-24, BR-25, BR-28) as pure functions.
 */
import type { DayStatus } from './tracking';

/** Statuses that are not scheduled working days (BR-24). */
const UNSCHEDULED: readonly DayStatus[] = ['holiday', 'weekly_off', 'future', 'not_employed'];

/** BR-24: the days in a period that are neither holidays, weekly offs, future nor outside employment. */
export function scheduledDays(days: readonly { status: DayStatus }[]): number {
  return days.filter((day) => !UNSCHEDULED.includes(day.status)).length;
}

/** BR-25: paid days, the sum of the days' values. */
export function paidDays(days: readonly { value: number }[]): number {
  return Math.round(days.reduce((sum, day) => sum + day.value, 0) * 2) / 2;
}

/** BR-28: a regularisation's reason runs from 3 to 600 characters (M13). */
export const REGULARISATION_REASON = { min: 3, max: 600 } as const;

/**
 * BR-28: why a day can't be regularised, or null: not in the future, and not before the person
 * joined. One open request per day is the server's to check.
 */
export function regularisationIssue(
  date: string,
  today: string,
  joiningDate: string | null,
): 'future' | 'before_joining' | null {
  if (date > today) return 'future';
  if (joiningDate && date < joiningDate) return 'before_joining';
  return null;
}
