import { type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * A condition that a moment falls on a date on the tenant's clock. It first narrows to the UTC
 * days around that date, which no time zone is further from, so an index on the moment still
 * serves (BR-03).
 */
export function onLocalDate(column: AnyPgColumn, date: string, timezone: string): SQL {
  const day = Date.parse(`${date}T00:00:00Z`);
  const from = new Date(day - 86_400_000);
  const to = new Date(day + 2 * 86_400_000);
  return sql`(${column} >= ${from.toISOString()} and ${column} < ${to.toISOString()} and (${column} at time zone ${timezone})::date = ${date}::date)`;
}

/** Minutes the time zone is ahead of UTC at a moment. */
function offsetMinutes(timezone: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const value = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return Math.round((asUtc - at) / 60_000);
}

/** The moment a date begins on the tenant's clock. */
export function startOfLocalDate(date: string, timezone: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const first = guess - offsetMinutes(timezone, guess) * 60_000;
  // Once more at the found moment, in case a clock change lies between.
  return new Date(guess - offsetMinutes(timezone, first) * 60_000);
}

/** The moments a `YYYY-MM` month begins and ends on the tenant's clock. */
export function localMonth(period: string, timezone: string): { from: Date; to: Date } {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  return {
    from: startOfLocalDate(`${period}-01`, timezone),
    to: startOfLocalDate(`${next}-01`, timezone),
  };
}
