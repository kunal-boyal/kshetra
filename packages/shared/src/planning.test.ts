import { describe, expect, it } from 'vitest';
import { daysOf, isoWeekday, nextPlanStatus, routeDates } from './planning';

describe('the dates a route falls on (M8)', () => {
  it('knows the days of a month and their weekdays', () => {
    expect(daysOf('2026-02')).toHaveLength(28);
    expect(daysOf('2028-02')).toHaveLength(29);
    // 1 October 2026 is a Thursday.
    expect(isoWeekday('2026-10-01')).toBe(4);
    expect(isoWeekday('2026-10-04')).toBe(7);
  });

  it('falls on chosen weekdays, as a weekly beat does', () => {
    expect(routeDates({ kind: 'weekdays', days: [1, 4] }, '2026-10')).toEqual([
      '2026-10-01',
      '2026-10-05',
      '2026-10-08',
      '2026-10-12',
      '2026-10-15',
      '2026-10-19',
      '2026-10-22',
      '2026-10-26',
      '2026-10-29',
    ]);
  });

  it('falls on weekdays in chosen weeks of the month, as a call pattern does', () => {
    // The first and third Mondays: weeks are days 1–7, 8–14, 15–21 and so on.
    expect(routeDates({ kind: 'weeks_of_month', weeks: [1, 3], days: [1] }, '2026-10')).toEqual([
      '2026-10-05',
      '2026-10-19',
    ]);
  });

  it('falls every N days from its first date, never before it', () => {
    expect(routeDates({ kind: 'every_n_days', every: 10, from: '2026-09-25' }, '2026-10')).toEqual([
      '2026-10-05',
      '2026-10-15',
      '2026-10-25',
    ]);
    expect(routeDates({ kind: 'every_n_days', every: 7, from: '2026-10-20' }, '2026-10')).toEqual([
      '2026-10-20',
      '2026-10-27',
    ]);
  });
});

describe('a plan item’s status (BR-35)', () => {
  it('moves from planned to visited to completed', () => {
    expect(nextPlanStatus('planned', { kind: 'visit_started' })).toBe('visited');
    expect(nextPlanStatus('visited', { kind: 'visit_started' })).toBe('visited');
    expect(nextPlanStatus('visited', { kind: 'submission_approved' })).toBe('completed');
  });

  it('goes back to planned on a rejection the same day, or to missed after it', () => {
    expect(nextPlanStatus('visited', { kind: 'submission_rejected', dayEnded: false })).toBe(
      'planned',
    );
    expect(nextPlanStatus('completed', { kind: 'submission_rejected', dayEnded: true })).toBe(
      'missed',
    );
    // A decision changed back to approved completes it again.
    expect(nextPlanStatus('missed', { kind: 'submission_approved' })).toBe('completed');
  });

  it('misses a planned item when its day ends, and cancels only a planned one', () => {
    expect(nextPlanStatus('planned', { kind: 'day_ended' })).toBe('missed');
    expect(nextPlanStatus('visited', { kind: 'day_ended' })).toBeNull();
    expect(nextPlanStatus('planned', { kind: 'cancelled' })).toBe('cancelled');
    expect(nextPlanStatus('visited', { kind: 'cancelled' })).toBeNull();
    expect(nextPlanStatus('cancelled', { kind: 'visit_started' })).toBeNull();
  });
});
