/**
 * Today's date (`YYYY-MM-DD`) in a timezone. Calendar dates belong to the tenant's timezone
 * (spec 10.1), so local rules, such as which attachments apply today, use this date.
 */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // The Canadian English format is ISO 8601: 2026-10-05.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}
