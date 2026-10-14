/**
 * Journey plans (M8): the dates a route falls on in a month, and how a plan item's status moves
 * (BR-35). The server applies them; the apps preview them.
 */

export const PLAN_ITEM_STATUSES = [
  'planned',
  'visited',
  'completed',
  'missed',
  'cancelled',
] as const;
export type PlanItemStatus = (typeof PLAN_ITEM_STATUSES)[number];

/** How often a route comes round (M8). Weekdays are ISO: 1 is Monday, 7 is Sunday. */
export type RouteRecurrence =
  | { kind: 'weekdays'; days: number[] }
  /** The listed weekdays in the listed weeks of the month: week 1 is days 1 to 7, and so on. */
  | { kind: 'weeks_of_month'; weeks: number[]; days: number[] }
  /** Every N days, counting from a first date. */
  | { kind: 'every_n_days'; every: number; from: string };

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of a UTC midnight. */
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

/** The days of a `YYYY-MM` period, as `YYYY-MM-DD`. */
export function daysOf(period: string): string[] {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => iso(Date.UTC(year, month - 1, index + 1)));
}

/** ISO weekday of a `YYYY-MM-DD`: 1 is Monday, 7 is Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The dates in a month a route falls on, in order (M8). */
export function routeDates(recurrence: RouteRecurrence, period: string): string[] {
  const days = daysOf(period);
  switch (recurrence.kind) {
    case 'weekdays':
      return days.filter((date) => recurrence.days.includes(isoWeekday(date)));
    case 'weeks_of_month':
      return days.filter(
        (date) =>
          recurrence.days.includes(isoWeekday(date)) &&
          recurrence.weeks.includes(Math.ceil(Number(date.slice(8, 10)) / 7)),
      );
    case 'every_n_days': {
      const start = Date.parse(`${recurrence.from}T00:00:00Z`);
      return days.filter((date) => {
        const since = Math.round((Date.parse(`${date}T00:00:00Z`) - start) / DAY_MS);
        return since >= 0 && since % recurrence.every === 0;
      });
    }
  }
}

/** What happens to a plan item (BR-35). */
export type PlanEvent =
  | { kind: 'visit_started' }
  | { kind: 'submission_approved' }
  | { kind: 'submission_rejected'; dayEnded: boolean }
  | { kind: 'day_ended' }
  | { kind: 'cancelled' };

/**
 * A plan item's status after an event (BR-35), or null when the event doesn't apply to it:
 * - a visit started from it moves `planned` to `visited` (a second visit leaves it `visited`);
 * - an approved submission of its visit completes it, also after an earlier rejection;
 * - a rejected one returns it to `planned`, or to `missed` once its local day has ended;
 * - a `planned` item is `missed` when its day ends, and only a `planned` one can be cancelled.
 */
export function nextPlanStatus(status: PlanItemStatus, event: PlanEvent): PlanItemStatus | null {
  switch (event.kind) {
    case 'visit_started':
      return status === 'planned' || status === 'visited' ? 'visited' : null;
    case 'submission_approved':
      return status === 'cancelled' || status === 'completed' ? null : 'completed';
    case 'submission_rejected':
      return status === 'visited' || status === 'completed'
        ? event.dayEnded
          ? 'missed'
          : 'planned'
        : null;
    case 'day_ended':
      return status === 'planned' ? 'missed' : null;
    case 'cancelled':
      return status === 'planned' ? 'cancelled' : null;
  }
}
