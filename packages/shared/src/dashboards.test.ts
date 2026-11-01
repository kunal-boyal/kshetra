import { describe, expect, it } from 'vitest';
import { dashboardLayoutIssues, type LayoutMetric } from './dashboards';

const metrics: LayoutMetric[] = [
  { key: 'visits', available: true, additive: true },
  { key: 'coverage', available: true, additive: false },
  { key: 'later', available: false, additive: true },
];

describe('Home layouts (D122)', () => {
  it('takes a layout whose metrics and levels exist', () => {
    expect(
      dashboardLayoutIssues(
        [
          { kind: 'tiles', metrics: ['visits', 'coverage'] },
          { kind: 'trend', metrics: ['visits'] },
          { kind: 'breakdown', metric: 'coverage', by: 'person' },
          { kind: 'breakdown', metric: 'visits', by: 'territory', level: 'district' },
          { kind: 'leaderboard' },
          { kind: 'waiting' },
        ],
        metrics,
        ['state', 'district'],
      ),
    ).toEqual([]);
  });

  it('names each problem at its card', () => {
    expect(
      dashboardLayoutIssues(
        [
          { kind: 'tiles', metrics: ['visits', 'nothing', 'visits'] },
          { kind: 'trend', metrics: ['coverage', 'later'] },
          { kind: 'breakdown', metric: 'coverage', by: 'territory', level: 'block' },
          { kind: 'breakdown', metric: 'visits', by: 'person', level: 'state' },
          { kind: 'mix' },
          { kind: 'mix' },
        ],
        metrics,
        ['state', 'district'],
      ),
    ).toEqual([
      { path: 'cards[0].metrics', issue: 'visits is named twice' },
      { path: 'cards[0].metrics[1]', issue: 'There is no metric nothing' },
      { path: 'cards[1].metrics[0]', issue: "coverage doesn't add up day by day" },
      { path: 'cards[1].metrics[1]', issue: "later isn't worked out yet" },
      { path: 'cards[2].level', issue: 'There is no level block' },
      { path: 'cards[2].metric', issue: "coverage doesn't add up across people" },
      { path: 'cards[3].level', issue: 'Only a territory breakdown has a level' },
      { path: 'cards[5]', issue: 'This card is there already' },
    ]);
  });
});
