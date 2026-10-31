import { describe, expect, it } from 'vitest';
import { isoWeekday } from './planning';
import {
  closeLeaveYear,
  leaveBalance,
  leaveCredited,
  leaveDays,
  leaveIssues,
  quotaYear,
} from './leave';

const TYPE = { annualQuota: 12, halfDayAllowed: true, attachmentAfterDays: 2, active: true };
const request = (patch: Partial<Parameters<typeof leaveIssues>[0]> = {}) => ({
  start: '2026-11-02',
  end: '2026-11-02',
  halfDay: false,
  days: 1,
  hasAttachment: false,
  type: TYPE,
  used: 0,
  overlaps: false,
  ...patch,
});

describe('BR-27: leave days', () => {
  it('FX-20: Friday to Monday, with Sunday off and Saturday a holiday, is 2 days', () => {
    // 2026-10-30 is a Friday.
    expect(isoWeekday('2026-10-30')).toBe(5);
    const off = (date: string) => isoWeekday(date) === 7 || date === '2026-10-31';
    expect(leaveDays({ start: '2026-10-30', end: '2026-11-02', halfDay: false }, off)).toBe(2);
  });

  it('halves a half day, and counts nothing on a day off', () => {
    const none = () => false;
    expect(leaveDays({ start: '2026-11-02', end: '2026-11-02', halfDay: true }, none)).toBe(0.5);
    expect(leaveDays({ start: '2026-11-01', end: '2026-11-01', halfDay: false }, () => true)).toBe(
      0,
    );
  });

  it('counts the quota in the start date’s calendar or financial year', () => {
    expect(quotaYear('2026-03-15', 'calendar', 4)).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(quotaYear('2026-03-15', 'financial', 4)).toEqual({
      from: '2025-04-01',
      to: '2026-03-31',
    });
    expect(quotaYear('2026-04-01', 'financial', 4)).toEqual({
      from: '2026-04-01',
      to: '2027-03-31',
    });
  });
});

describe('BR-27: what refuses a request', () => {
  it('accepts a working day within the quota', () => {
    expect(leaveIssues(request())).toEqual([]);
  });

  it('refuses the quota passed, counting pending and approved days, and an overlap', () => {
    expect(leaveIssues(request({ used: 11.5 })).map((issue) => issue.code)).toEqual([
      'QUOTA_EXCEEDED',
    ]);
    expect(leaveIssues(request({ used: 11 }))).toEqual([]);
    // A type without a quota never runs out.
    expect(leaveIssues(request({ used: 400, type: { ...TYPE, annualQuota: 0 } }))).toEqual([]);
    expect(leaveIssues(request({ overlaps: true }))).toEqual([
      { path: 'startDate', issue: 'overlap', code: 'CONFLICT' },
    ]);
  });

  it('refuses half days where the type has none, or across days, and ranges without working days', () => {
    expect(
      leaveIssues(request({ halfDay: true, type: { ...TYPE, halfDayAllowed: false } })),
    ).toEqual([{ path: 'halfDay', issue: 'half_day_not_allowed', code: 'VALIDATION' }]);
    expect(leaveIssues(request({ halfDay: true, end: '2026-11-03', days: 1 }))[0]!.issue).toBe(
      'half_day_one_day',
    );
    expect(leaveIssues(request({ days: 0 }))[0]!.issue).toBe('no_working_days');
    expect(leaveIssues(request({ end: '2026-11-01' }))).toEqual([
      { path: 'endDate', issue: 'end_before_start', code: 'VALIDATION' },
    ]);
  });

  it('asks for an attachment past the type’s days, and refuses a type switched off', () => {
    expect(leaveIssues(request({ end: '2026-11-04', days: 3 }))[0]!.issue).toBe(
      'attachment_required',
    );
    expect(leaveIssues(request({ end: '2026-11-04', days: 3, hasAttachment: true }))).toEqual([]);
    expect(leaveIssues(request({ type: { ...TYPE, active: false } }))[0]!.issue).toBe(
      'inactive_type',
    );
  });

  it('shows what is left of a quota', () => {
    const figures = { credited: 12, carriedIn: 0, lapsed: 0 };
    expect(leaveBalance({ annualQuota: 12, approved: 4, pending: 1.5, ...figures })).toEqual({
      quota: 12,
      credited: 12,
      carriedIn: 0,
      approved: 4,
      pending: 1.5,
      available: 6.5,
      lapsed: 0,
    });
    expect(leaveBalance({ annualQuota: 0, approved: 3, pending: 0, ...figures })).toEqual({
      quota: null,
      credited: null,
      carriedIn: 0,
      approved: 3,
      pending: 0,
      available: null,
      lapsed: 0,
    });
  });

  it('refuses more than the year allows by the start date when an allowance is given (D114)', () => {
    expect(leaveIssues(request({ used: 2, days: 2, allowance: 3 })).map((i) => i.code)).toEqual([
      'QUOTA_EXCEEDED',
    ]);
    expect(leaveIssues(request({ used: 2, days: 1, allowance: 3 }))).toEqual([]);
    // Days carried in may take a request past the year's own quota.
    expect(leaveIssues(request({ used: 12, days: 2, allowance: 15 }))).toEqual([]);
  });
});

describe('D114: accrual and carry-forward', () => {
  const calendar = { from: '2026-01-01', to: '2026-12-31' };
  const monthly = (annualQuota: number) => ({ annualQuota, accrual: 'monthly' as const });
  const months = (quota: number) =>
    Array.from({ length: 12 }, (_, m) =>
      leaveCredited(monthly(quota), calendar, `2026-${String(m + 1).padStart(2, '0')}-15`, null),
    );

  it('credits a yearly quota whole, and a type without a quota nothing', () => {
    expect(
      leaveCredited({ annualQuota: 12, accrual: 'yearly' }, calendar, '2026-01-01', null),
    ).toBe(12);
    expect(leaveCredited(monthly(0), calendar, '2026-06-01', null)).toBe(0);
    // Nothing for a year that ended before the person joined.
    expect(
      leaveCredited({ annualQuota: 12, accrual: 'yearly' }, calendar, '2026-12-31', '2027-01-04'),
    ).toBe(0);
  });

  it('credits a month at a time in whole half days, ending on the quota', () => {
    expect(months(12)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(months(18)).toEqual([1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12, 13.5, 15, 16.5, 18]);
    expect(months(10)).toEqual([0.5, 1.5, 2.5, 3, 4, 5, 5.5, 6.5, 7.5, 8, 9, 10]);
  });

  it('credits a joiner from their joining month, and a financial year from its own first month', () => {
    expect(leaveCredited(monthly(12), calendar, '2026-08-31', '2026-09-14')).toBe(0);
    expect(leaveCredited(monthly(12), calendar, '2026-09-01', '2026-09-14')).toBe(1);
    expect(leaveCredited(monthly(12), calendar, '2026-12-31', '2026-09-14')).toBe(4);
    const financial = { from: '2026-04-01', to: '2027-03-31' };
    expect(leaveCredited(monthly(12), financial, '2026-04-10', null)).toBe(1);
    expect(leaveCredited(monthly(12), financial, '2027-01-10', null)).toBe(10);
    // Someone who joined before the year gets every month of it.
    expect(leaveCredited(monthly(12), financial, '2026-05-10', '2019-07-01')).toBe(2);
  });

  it('carries unused days up to the cap and lapses the rest', () => {
    expect(closeLeaveYear({ credited: 12, carriedIn: 3, taken: 7, cap: 5 })).toEqual({
      carriedOut: 5,
      lapsed: 3,
    });
    expect(closeLeaveYear({ credited: 12, carriedIn: 0, taken: 9.5, cap: 5 })).toEqual({
      carriedOut: 2.5,
      lapsed: 0,
    });
    expect(closeLeaveYear({ credited: 12, carriedIn: 0, taken: 4, cap: 0 })).toEqual({
      carriedOut: 0,
      lapsed: 8,
    });
    // Taking more than was there carries and lapses nothing.
    expect(closeLeaveYear({ credited: 6, carriedIn: 0, taken: 8, cap: 5 })).toEqual({
      carriedOut: 0,
      lapsed: 0,
    });
  });
});
