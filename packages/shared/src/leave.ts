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
 * `overlaps` whether another pending or approved request covers any of its dates.
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
  if (type.annualQuota > 0 && request.used + request.days > type.annualQuota) {
    issues.push({ path: 'leaveType', issue: 'quota', code: 'QUOTA_EXCEEDED' });
  }
  return issues;
}

/** A type's balance in a quota year; `available` is null for a type without a quota. */
export function leaveBalance(
  annualQuota: number,
  approved: number,
  pending: number,
): { quota: number | null; approved: number; pending: number; available: number | null } {
  return {
    quota: annualQuota > 0 ? annualQuota : null,
    approved,
    pending,
    available: annualQuota > 0 ? Math.max(0, annualQuota - approved - pending) : null,
  };
}
