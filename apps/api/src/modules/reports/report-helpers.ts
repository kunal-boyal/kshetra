import { startOfLocalDate } from '../../platform/local-day';
import type { ReportContext } from './sources';

/** The moments a report's month begins and ends on the tenant's clock. */
export function monthMoments(context: ReportContext): { from: Date; to: Date } {
  const next = new Date(Date.parse(`${context.to}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    from: startOfLocalDate(context.from, context.timezone),
    to: startOfLocalDate(next, context.timezone),
  };
}

/** A page of a report read by offset: its rows, and the next offset when there are more. */
export function offsetPage<T>(rows: readonly T[], offset: number, limit: number) {
  return {
    shown: rows.slice(0, limit),
    nextCursor: rows.length > limit ? String(offset + limit) : null,
  };
}
