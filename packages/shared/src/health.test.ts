import { describe, expect, it } from 'vitest';
import { type CellFigures, healthIssues } from './health';

const NOW = new Date('2026-10-26T10:00:00Z');
const QUIET: CellFigures = {
  requests: 400,
  errors: 2,
  points: 900,
  latePoints: 30,
  queues: {
    notifications: { waiting: 3, active: 1, delayed: 0, failed: 0, oldestWaitSeconds: 12 },
  },
  outbox: { backlog: 0, oldestSeconds: null },
  phones: { seen: 120, waiting: 8, parked: 0, oldestQueuedSeconds: 600 },
};
const at = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe('health per cell (spec 14.6, decision D93)', () => {
  it('has nothing to say about a cell within its limits', () => {
    expect(healthIssues({ at: at(60), figures: QUIET }, NOW)).toEqual([]);
  });

  it('says when a cell has gone quiet', () => {
    expect(healthIssues(null, NOW)).toEqual([{ key: 'silent' }]);
    expect(healthIssues({ at: at(181), figures: QUIET }, NOW)).toEqual([{ key: 'silent' }]);
  });

  it('flags errors above 2% once there is traffic, slow queues, the outbox and phones behind', () => {
    const figures: CellFigures = {
      ...QUIET,
      errors: 9,
      queues: {
        ...QUIET.queues,
        exports: { waiting: 40, active: 1, delayed: 0, failed: 2, oldestWaitSeconds: 301 },
      },
      outbox: { backlog: 12, oldestSeconds: 400 },
      phones: { ...QUIET.phones, oldestQueuedSeconds: 3601 },
    };
    expect(healthIssues({ at: at(30), figures }, NOW)).toEqual([
      { key: 'errors' },
      { key: 'queue', queue: 'exports' },
      { key: 'outbox' },
      { key: 'sync' },
    ]);
    // A few errors in a quiet minute say little.
    expect(
      healthIssues({ at: at(30), figures: { ...QUIET, requests: 10, errors: 3 } }, NOW),
    ).toEqual([]);
  });
});
