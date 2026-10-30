import { describe, expect, it } from 'vitest';
import {
  currentPeriod,
  isPeriodKey,
  nextPeriod,
  periodDates,
  periodKeyIssue,
  periodKind,
  periodMonthKeys,
  periodMonths,
  periodOf,
  periodSwitchIssue,
  previousPeriod,
} from './periods';

const APRIL = 4;
const JANUARY = 1;

describe('period keys', () => {
  it('knows the three kinds and refuses anything else', () => {
    expect(periodKind('2026-10')).toBe('month');
    expect(periodKind('FY2026-Q3')).toBe('quarter');
    expect(periodKind('FY2026')).toBe('year');
    for (const bad of ['2026-13', '2026-Q3', 'FY2026-Q5', 'FY26', '2026', 'fy2026']) {
      expect(isPeriodKey(bad)).toBe(false);
    }
    expect(periodMonths('FY2026-Q1')).toBe(3);
    expect(periodMonths('FY2026')).toBe(12);
  });
});

describe('periodDates', () => {
  it('gives a month its own days, whatever the year start', () => {
    expect(periodDates('2026-10', APRIL)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodDates('2028-02', JANUARY)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('counts quarters and years from an April start', () => {
    expect(periodDates('FY2026-Q1', APRIL)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(periodDates('FY2026-Q3', APRIL)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodDates('FY2027-Q4', APRIL)).toEqual({ from: '2028-01-01', to: '2028-03-31' });
    expect(periodDates('FY2026', APRIL)).toEqual({ from: '2026-04-01', to: '2027-03-31' });
  });

  it('falls on the calendar with a January start', () => {
    expect(periodDates('FY2026-Q1', JANUARY)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(periodDates('FY2026', JANUARY)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('lists the months a period spans, February once', () => {
    expect(periodMonthKeys('FY2027-Q4', APRIL)).toEqual(['2028-01', '2028-02', '2028-03']);
    expect(periodMonthKeys('FY2026', APRIL)).toHaveLength(12);
    expect(periodMonthKeys('FY2026', APRIL)[11]).toBe('2027-03');
  });
});

describe('periodOf', () => {
  it('finds the period a day falls in', () => {
    expect(periodOf('month', '2026-10-30', APRIL)).toBe('2026-10');
    expect(periodOf('quarter', '2026-10-30', APRIL)).toBe('FY2026-Q3');
    expect(periodOf('quarter', '2027-03-31', APRIL)).toBe('FY2026-Q4');
    expect(periodOf('quarter', '2027-04-01', APRIL)).toBe('FY2027-Q1');
    expect(periodOf('year', '2027-02-14', APRIL)).toBe('FY2026');
    expect(periodOf('quarter', '2026-10-30', JANUARY)).toBe('FY2026-Q4');
  });
});

describe('shifting periods', () => {
  it('steps across years', () => {
    expect(previousPeriod('2026-01')).toBe('2025-12');
    expect(nextPeriod('FY2026-Q4')).toBe('FY2027-Q1');
    expect(previousPeriod('FY2026-Q1')).toBe('FY2025-Q4');
    expect(nextPeriod('FY2026')).toBe('FY2027');
  });
});

describe('the kind in force', () => {
  const quarterly = { periodType: 'quarter' as const };
  const switching = {
    periodType: 'quarter' as const,
    periodFrom: 'FY2026-Q4',
    earlierPeriodType: 'month' as const,
  };

  it('is the month without a score, and the score period with one', () => {
    expect(currentPeriod(null, '2026-10-30', APRIL)).toBe('2026-10');
    expect(currentPeriod(quarterly, '2026-10-30', APRIL)).toBe('FY2026-Q3');
  });

  it('keeps the earlier kind until the switch', () => {
    expect(currentPeriod(switching, '2026-12-31', APRIL)).toBe('2026-12');
    expect(currentPeriod(switching, '2027-01-01', APRIL)).toBe('FY2026-Q4');
  });

  it('refuses a key of the wrong kind for its days, naming the expected one', () => {
    expect(periodKeyIssue('2026-11', switching, APRIL)).toBeNull();
    expect(periodKeyIssue('FY2026-Q4', switching, APRIL)).toBeNull();
    expect(periodKeyIssue('FY2026-Q3', switching, APRIL)).toMatch(/month.*2026-10/);
    expect(periodKeyIssue('2027-01', switching, APRIL)).toMatch(/quarter.*FY2026-Q4/);
  });
});

describe('periodSwitchIssue', () => {
  const today = '2026-10-30';

  it('lets the kind stay as it is', () => {
    expect(periodSwitchIssue(null, { periodType: 'month' }, today, APRIL)).toBeNull();
  });

  it('starts a new kind only at a period still to come', () => {
    expect(periodSwitchIssue(null, { periodType: 'quarter' }, today, APRIL)).toMatch(
      /first period/,
    );
    expect(
      periodSwitchIssue(null, { periodType: 'quarter', periodFrom: 'FY2026-Q3' }, today, APRIL),
    ).toMatch(/has begun/);
    expect(
      periodSwitchIssue(null, { periodType: 'quarter', periodFrom: 'FY2026-Q4' }, today, APRIL),
    ).toBeNull();
    expect(
      periodSwitchIssue(null, { periodType: 'quarter', periodFrom: '2026-12' }, today, APRIL),
    ).toMatch(/FY2026-Q3/);
  });

  it('starts where the kind before it ends', () => {
    const quarterly = { periodType: 'quarter' as const };
    expect(
      periodSwitchIssue(quarterly, { periodType: 'year', periodFrom: 'FY2027' }, today, APRIL),
    ).toBeNull();
    expect(
      periodSwitchIssue(quarterly, { periodType: 'month', periodFrom: '2026-12' }, today, APRIL),
    ).toMatch(/quarter ends/);
    expect(
      periodSwitchIssue(quarterly, { periodType: 'month', periodFrom: '2027-01' }, today, APRIL),
    ).toBeNull();
  });
});
