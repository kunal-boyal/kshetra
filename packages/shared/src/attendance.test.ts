import { describe, expect, it } from 'vitest';
import { paidDays, regularisationIssue, scheduledDays } from './attendance';
import { isoWeekday } from './planning';
import type { DayStatus } from './tracking';

const days = (pairs: [DayStatus, number][]) => pairs.map(([status, value]) => ({ status, value }));

describe('attendance over a period (M13)', () => {
  it('knows the weekday', () => {
    expect(isoWeekday('2026-10-24')).toBe(6);
    expect(isoWeekday('2026-10-25')).toBe(7);
    expect(isoWeekday('2026-10-26')).toBe(1);
  });

  it('BR-24, BR-25: schedules working days and adds their values', () => {
    const month = days([
      ['present', 1],
      ['half_day', 0.5],
      ['paid_leave', 1],
      ['unpaid_leave', 0],
      ['absent', 0],
      ['holiday', 0],
      ['weekly_off', 0],
      ['future', 0],
      ['not_employed', 0],
    ]);
    expect(scheduledDays(month)).toBe(5);
    expect(paidDays(month)).toBe(2.5);
  });

  it('BR-28: a day neither ahead nor before joining', () => {
    expect(regularisationIssue('2026-10-20', '2026-10-24', '2026-01-01')).toBeNull();
    expect(regularisationIssue('2026-10-25', '2026-10-24', null)).toBe('future');
    expect(regularisationIssue('2025-12-31', '2026-10-24', '2026-01-01')).toBe('before_joining');
  });
});
