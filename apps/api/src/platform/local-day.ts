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
