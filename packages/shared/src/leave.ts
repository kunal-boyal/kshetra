/**
 * Leave rules (spec M13, BR-27) as pure functions: the days a request counts, the quota year it
 * counts in, and what refuses it. The server is authoritative; the apps call them to preview.
 */
import { financialYear } from './finance';

/** The longest stretch one request may cover, in calendar days. */
export const LEAVE_MAX_SPAN_DAYS = 366;

/** A leave request's reason, when given, runs to 600 characters. */
export const LEAVE_REASON_MAX = 600;

const DAY = 86_400_000;

/** Every date from `start` to `end`, both included. */
export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let at = Date.parse(`${start}T00:00:00Z`); at <= Date.parse(`${end}T00:00:00Z`); at += DAY) {
    dates.push(new Date(at).toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * BR-27: the working days in a range, leaving out the weekly offs and holidays of the person's
 * calendar (`isOff`), halved for a half-day leave.
 */
export function leaveDays(
  range: { start: string; end: string; halfDay: boolean },
  isOff: (date: string) => boolean,
): number {
  const working = datesBetween(range.start, range.end).filter((date) => !isOff(date)).length;
  return range.halfDay ? working / 2 : working;
}

/** The quota year a day falls in: the calendar year, or the tenant's financial year. */
export function quotaYear(
  day: string,
  kind: 'calendar' | 'financial',
  financialYearStartMonth: number,
): { from: string; to: string } {
  if (kind === 'calendar')
    return { from: `${day.slice(0, 4)}-01-01`, to: `${day.slice(0, 4)}-12-31` };
  const { from, to } = financialYear(day, financialYearStartMonth);
  return { from, to };
}

/** What a leave type says about requests of it (spec 5.10). */
export interface LeaveTypeRule {
  annualQuota: number;
  halfDayAllowed: boolean;
  attachmentAfterDays?: number | undefined;
  active: boolean;
}

/** How a type credits its quota (decision D114): all on the year's first day, or month by month. */
export type LeaveAccrual = 'yearly' | 'monthly';

const monthIndex = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;

/**
 * D114: the days of a type credited by a day of its quota year. A yearly type credits its whole
 * quota; a monthly one credits a share for each month from the year's first month, or the
 * person's joining month if later, through the day's month, in whole half days rounded down, so
 * the year's last month brings the total to the quota exactly.
 */
export function leaveCredited(
  type: { annualQuota: number; accrual: LeaveAccrual },
  year: { from: string; to: string },
  day: string,
  joiningDate: string | null,
): number {
  if (type.annualQuota <= 0 || (joiningDate !== null && joiningDate > year.to)) return 0;
  if (type.accrual === 'yearly') return type.annualQuota;
  const first = monthIndex(year.from);
  const last = monthIndex(year.to);
  const start = Math.max(first, joiningDate ? monthIndex(joiningDate) : first);
  const through = Math.min(last, monthIndex(day));
  const months = Math.max(0, through - start + 1);
  return Math.floor(((type.annualQuota * months) / (last - first + 1)) * 2) / 2;
}

/**
 * D114: a quota year closed. What was credited and carried in, less what was taken, carries into
 * the next year up to the cap; the rest lapses.
 */
export function closeLeaveYear(year: {
  credited: number;
  carriedIn: number;
  taken: number;
  cap: number;
}): { carriedOut: number; lapsed: number } {
  const unused = Math.max(0, year.credited + year.carriedIn - year.taken);
  const carriedOut = Math.min(Math.max(0, year.cap), unused);
  return { carriedOut, lapsed: unused - carriedOut };
}

/** Why a request is refused, with the field it concerns and the spec 11.4 code it answers. */
export interface LeaveIssue {
  path: 'leaveType' | 'startDate' | 'endDate' | 'halfDay' | 'attachmentId';
  issue:
    | 'inactive_type'
    | 'end_before_start'
    | 'too_long'
    | 'half_day_not_allowed'
    | 'half_day_one_day'
    | 'no_working_days'
    | 'attachment_required'
    | 'overlap'
    | 'quota';
  code: 'VALIDATION' | 'CONFLICT' | 'QUOTA_EXCEEDED';
}

/**
 * BR-27: what refuses a leave request, every problem in the order a person fixes them. `used` is
 * the days of this type already pending or approved in the start date's quota year, and
 * `overlaps` whether another pending or approved request covers any of its dates. `allowance` is
 * what the year allows by the start date, credited and carried in (D114); the year's quota when
 * left out.
 */
export function leaveIssues(request: {
  start: string;
  end: string;
  halfDay: boolean;
  days: number;
  hasAttachment: boolean;
  type: LeaveTypeRule;
  used: number;
  overlaps: boolean;
  allowance?: number | undefined;
}): LeaveIssue[] {
  const issues: LeaveIssue[] = [];
  const { type } = request;
  if (!type.active) issues.push({ path: 'leaveType', issue: 'inactive_type', code: 'VALIDATION' });
  if (request.end < request.start) {
    issues.push({ path: 'endDate', issue: 'end_before_start', code: 'VALIDATION' });
    return issues;
  }
  const span = (Date.parse(request.end) - Date.parse(request.start)) / DAY + 1;
  if (span > LEAVE_MAX_SPAN_DAYS) {
    issues.push({ path: 'endDate', issue: 'too_long', code: 'VALIDATION' });
  }
  if (request.halfDay && !type.halfDayAllowed) {
    issues.push({ path: 'halfDay', issue: 'half_day_not_allowed', code: 'VALIDATION' });
  } else if (request.halfDay && request.start !== request.end) {
    issues.push({ path: 'halfDay', issue: 'half_day_one_day', code: 'VALIDATION' });
  }
  if (request.days <= 0) {
    issues.push({ path: 'startDate', issue: 'no_working_days', code: 'VALIDATION' });
  }
  if (
    type.attachmentAfterDays !== undefined &&
    request.days > type.attachmentAfterDays &&
    !request.hasAttachment
  ) {
    issues.push({ path: 'attachmentId', issue: 'attachment_required', code: 'VALIDATION' });
  }
  if (request.overlaps) issues.push({ path: 'startDate', issue: 'overlap', code: 'CONFLICT' });
  const allowance = request.allowance ?? type.annualQuota;
  if (type.annualQuota > 0 && request.used + request.days > allowance) {
    issues.push({ path: 'leaveType', issue: 'quota', code: 'QUOTA_EXCEEDED' });
  }
  return issues;
}

/**
 * A type's balance in a quota year (D114): what was credited by the day read and carried in, what
 * was approved and waits, what is left, and what lapsed once the year ended. The figures are null
 * for a type without a quota.
 */
export function leaveBalance(figures: {
  annualQuota: number;
  credited: number;
  carriedIn: number;
  approved: number;
  pending: number;
  lapsed: number;
}): {
  quota: number | null;
  credited: number | null;
  carriedIn: number;
  approved: number;
  pending: number;
  available: number | null;
  lapsed: number;
} {
  const { annualQuota, credited, carriedIn, approved, pending, lapsed } = figures;
  const limited = annualQuota > 0;
  return {
    quota: limited ? annualQuota : null,
    credited: limited ? credited : null,
    carriedIn: limited ? carriedIn : 0,
    approved,
    pending,
    available: limited ? Math.max(0, credited + carriedIn - approved - pending) : null,
    lapsed: limited ? lapsed : 0,
  };
}
