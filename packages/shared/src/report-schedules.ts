/**
 * Scheduled reports (M18, BR-52, decision D122): when a schedule sends, and which month it sends.
 * Everything is on the tenant's clock: dates are `YYYY-MM-DD` and times `HH:MM` there, so no rule
 * here converts to UTC, and a change of the clock can neither skip a send nor repeat one.
 */

export const SCHEDULE_FREQUENCIES = ['weekly', 'monthly'] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

/** The most people one schedule sends to. */
export const SCHEDULE_RECIPIENTS_MOST = 20;

/** The most schedules running at once in one organisation. */
export const SCHEDULES_PER_TENANT_MOST = 50;

/** When a schedule sends: a weekday (ISO, 1 is Monday) for weekly, the 1st for monthly. */
export interface ScheduleTiming {
  frequency: ScheduleFrequency;
  weekday: number | null;
  /** `HH:MM`, 24-hour, on the tenant's clock. */
  at: string;
}

/** A moment on the tenant's clock. */
export interface LocalMoment {
  date: string;
  time: string;
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
/** ISO weekday, 1 (Monday) to 7 (Sunday). */
const weekdayOf = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Whether the schedule sends on a date at all. */
function sendsOn(timing: ScheduleTiming, date: string): boolean {
  return timing.frequency === 'monthly' ? date.endsWith('-01') : weekdayOf(date) === timing.weekday;
}

/** The local date of the latest send moment at or before `now`. */
export function latestSendDate(timing: ScheduleTiming, now: LocalMoment): string {
  let day = dayNumber(now.date);
  if (!(sendsOn(timing, now.date) && now.time >= timing.at)) day -= 1;
  while (!sendsOn(timing, dateOf(day))) day -= 1;
  return dateOf(day);
}

/** The local date of the first send moment after `now`. */
export function nextSendDate(timing: ScheduleTiming, now: LocalMoment): string {
  let day = dayNumber(now.date);
  if (!(sendsOn(timing, now.date) && now.time < timing.at)) day += 1;
  while (!sendsOn(timing, dateOf(day))) day += 1;
  return dateOf(day);
}

/**
 * BR-52: the send a schedule owes at `now`, as the local date that keys its run, or null. It owes
 * the latest send moment that came after it started (or was resumed), so a scheduler that was down
 * sends once, for that moment, and never once for each it missed. A run already made for the key
 * is the caller's to skip, by the run's unique key.
 */
export function sendDue(
  timing: ScheduleTiming,
  activeFrom: LocalMoment,
  now: LocalMoment,
): string | null {
  const latest = latestSendDate(timing, now);
  const after =
    latest > activeFrom.date || (latest === activeFrom.date && timing.at >= activeFrom.time);
  return after ? latest : null;
}

/**
 * BR-52: the month a send reports. Monthly sends last month complete. Weekly sends the month of the
 * day before, so the month so far, and a send on the 1st sends last month complete.
 */
export function scheduledPeriod(frequency: ScheduleFrequency, sendDate: string): string {
  if (frequency === 'weekly') return dateOf(dayNumber(sendDate) - 1).slice(0, 7);
  const [year, month] = sendDate.split('-').map(Number) as [number, number];
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}
