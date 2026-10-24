import { describe, expect, it } from 'vitest';
import { isoWeekday } from './planning';
import { leaveBalance, leaveDays, leaveIssues, quotaYear } from './leave';

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
    expect(leaveBalance(12, 4, 1.5)).toEqual({
      quota: 12,
      approved: 4,
      pending: 1.5,
      available: 6.5,
    });
    expect(leaveBalance(0, 3, 0)).toEqual({
      quota: null,
      approved: 3,
      pending: 0,
      available: null,
    });
  });
});
