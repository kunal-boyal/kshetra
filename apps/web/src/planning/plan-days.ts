import type { CalendarListResult, LeaveRequestResult, PlanItemResult } from '@thelamp/shared';

type Calendar = CalendarListResult['items'][number];

/** A day of a person's plan month, as the calendar shows it (decision D104). */
export interface PlanDay {
  date: string;
  weeklyOff: boolean;
  /** The holiday's name; optional holidays never take a day off. */
  holiday: string | null;
  /** Leave taking in the day, waiting or approved. */
  leave: { state: 'pending' | 'approved'; leaveType: string } | null;
  /** The day's visits, cancelled ones left out. */
  items: PlanItemResult[];
}

/** Every date of a `YYYY-MM` month. */
export function monthDates(period: string): string[] {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from(
    { length: last },
    (_, index) => `${period}-${String(index + 1).padStart(2, '0')}`,
  );
}

/** The ISO weekday of a date, Monday 1 to Sunday 7. */
export const isoWeekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

/**
 * The person's calendar: their own, else the tenant's default. Null when calendars can't be read,
 * as with leave and attendance switched off.
 */
export function calendarOf(
  calendars: readonly Calendar[] | undefined,
  key: string | null,
): Calendar | null {
  if (!calendars) return null;
  return (
    calendars.find((calendar) => calendar.key === key) ??
    calendars.find((calendar) => calendar.default) ??
    null
  );
}

/** The month's days: weekly offs and holidays from the calendar, leave, and the planned visits. */
export function planDays(
  period: string,
  items: readonly PlanItemResult[],
  calendar: Calendar | null,
  leave: readonly LeaveRequestResult[],
): PlanDay[] {
  const offs = new Set(calendar?.weeklyOffs ?? []);
  const holidays = new Map(
    (calendar?.holidays ?? [])
      .filter((holiday) => !holiday.optional)
      .map((holiday) => [holiday.date, holiday.name]),
  );
  return monthDates(period).map((date) => {
    const taken = leave.find(
      (request) =>
        (request.state === 'pending' || request.state === 'approved') &&
        request.startDate <= date &&
        request.endDate >= date,
    );
    return {
      date,
      weeklyOff: offs.has(isoWeekday(date)),
      holiday: holidays.get(date) ?? null,
      leave: taken
        ? { state: taken.state as 'pending' | 'approved', leaveType: taken.leaveType }
        : null,
      items: items.filter((item) => item.date === date && item.status !== 'cancelled'),
    };
  });
}

/** Days that are worked: not a weekly off, a holiday or approved leave. */
export const workingDays = (days: readonly PlanDay[]) =>
  days.filter((day) => !day.weeklyOff && !day.holiday && day.leave?.state !== 'approved').length;

/**
 * What a day's visits are called: their route's name when they all came from one route, else the
 * first account's name; the day's stop count says how many more.
 */
export function visitsTitle(
  items: readonly PlanItemResult[],
  routeNames: ReadonlyMap<string, string>,
): string | null {
  if (items.length === 0) return null;
  const routes = new Set(items.map((item) => item.routeId));
  const [only] = routes;
  if (routes.size === 1 && only && routeNames.has(only)) return routeNames.get(only)!;
  return items[0]!.account.name;
}
