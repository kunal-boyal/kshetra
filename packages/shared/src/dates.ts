/**
 * Today's date (`YYYY-MM-DD`) in a timezone. Calendar dates belong to the tenant's timezone
 * (spec 10.1), so local rules, such as which attachments apply today, use this date.
 */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // The Canadian English format is ISO 8601: 2026-10-05.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

/** The time of day (`HH:MM`, 24-hour) in a timezone, for work scheduled at a tenant's local time. */
export function timeIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

/**
 * Whether a moment in the tenant's day (`HH:MM`) has come today, and the local date it belongs
 * to. Work keyed to that date runs once, however often this is asked (spec 12.3).
 */
export function momentDue(
  at: string,
  timeZone: string,
  now: Date = new Date(),
): { due: boolean; date: string } {
  return { due: timeIn(timeZone, now) >= at, date: todayIn(timeZone, now) };
}
