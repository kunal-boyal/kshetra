import { describe, expect, it } from 'vitest';
import { attainment, monthDates, rankByScore, rankCutoff, ratioOf, scoreOf } from './performance';

const FX01 = [
  { key: 'sales', target: 1000, actual: 2000 },
  { key: 'collection', target: 1000, actual: 500 },
  { key: 'liquidation', target: 1000, actual: 0 },
  { key: 'activities', target: 4, actual: 2 },
].map((metric) => ({ ...metric, weight: 25, direction: 'higher_is_better' as const }));

describe('the score (BR-06)', () => {
  it('FX-01: weights capped attainment', () => {
    expect(FX01.map((m) => Math.min(attainment(m.actual, m.target, m.direction)!, 1))).toEqual([
      1, 0.5, 0, 0.5,
    ]);
    expect(scoreOf({ locked: true, cap: 1, metrics: FX01 })).toBe(50);
  });

  it('FX-02: a draft target set is not ranked', () => {
    expect(scoreOf({ locked: false, cap: 1, metrics: FX01 })).toBeNull();
  });

  it('FX-03: a target of 0 leaves the person unranked', () => {
    const metrics = FX01.map((m) => (m.key === 'collection' ? { ...m, target: 0 } : m));
    expect(scoreOf({ locked: true, cap: 1, metrics })).toBeNull();
    const missing = FX01.map((m) => (m.key === 'sales' ? { ...m, target: null } : m));
    expect(scoreOf({ locked: true, cap: 1, metrics: missing })).toBeNull();
  });

  it('meets a lower-is-better target in full at an actual of 0', () => {
    expect(attainment(0, 10, 'lower_is_better')).toBe(1);
    expect(attainment(20, 10, 'lower_is_better')).toBe(0.5);
    expect(
      scoreOf({
        locked: true,
        cap: 1.2,
        metrics: [
          { key: 'a', weight: 1, direction: 'higher_is_better', actual: 15, target: 10 },
          { key: 'b', weight: 1, direction: 'lower_is_better', actual: 20, target: 10 },
        ],
      }),
    ).toBe(85);
  });

  it('counts a missing actual as nothing done', () => {
    expect(
      scoreOf({
        locked: true,
        cap: 1,
        metrics: [{ key: 'a', weight: 1, direction: 'higher_is_better', actual: null, target: 5 }],
      }),
    ).toBe(0);
  });
});

describe('ranks (BR-07)', () => {
  it('FX-04: equal scores share a rank, the next skips, and the unranked come last', () => {
    const ranked = rankByScore([
      { id: 'u', score: null },
      { id: 'a', score: 80 },
      { id: 'c', score: 70 },
      { id: 'b', score: 80 },
    ]);
    expect(ranked.map(({ row, rank }) => [row.id, rank])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
      ['u', null],
    ]);
  });
});

describe('ratios (BR-04)', () => {
  it('FX-06: a team ratio divides summed parts', () => {
    expect(ratioOf(10 + 2, 5 + 2)!.toFixed(2)).toBe('1.71');
    expect(ratioOf(1, 0)).toBeNull();
    expect(ratioOf(1, 4, true)).toBe(25);
  });
});

describe('months', () => {
  it('knows their first and last days', () => {
    expect(monthDates('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthDates('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('last week’s rank', () => {
  it('counts up to the Sunday before this week, within the month', () => {
    // Tuesday 27 October 2026: the week began on Monday the 26th.
    expect(rankCutoff(monthDates('2026-10'), '2026-10-27')).toBe('2026-10-25');
    // A Sunday belongs to its own week, so it reaches back a whole week.
    expect(rankCutoff(monthDates('2026-10'), '2026-10-25')).toBe('2026-10-18');
    expect(rankCutoff(monthDates('2026-10'), '2026-10-26')).toBe('2026-10-25');
  });

  it('shows no movement in a month’s first days, or before it begins', () => {
    expect(rankCutoff(monthDates('2026-10'), '2026-10-03')).toBeNull();
    expect(rankCutoff(monthDates('2026-11'), '2026-11-01')).toBeNull();
    expect(rankCutoff(monthDates('2026-11'), '2026-10-27')).toBeNull();
  });

  it('measures a month gone from its last week', () => {
    // September 2026 ended on Wednesday the 30th.
    expect(rankCutoff(monthDates('2026-09'), '2026-10-27')).toBe('2026-09-27');
  });

  it('reaches across months within a quarter', () => {
    // Q3 of an April year is October to December; Tuesday 3 November 2026.
    const quarter = { from: '2026-10-01', to: '2026-12-31' };
    expect(rankCutoff(quarter, '2026-11-03')).toBe('2026-11-01');
    expect(rankCutoff(quarter, '2026-10-03')).toBeNull();
  });
});
