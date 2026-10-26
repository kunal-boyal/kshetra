import { describe, expect, it } from 'vitest';
import { cellMetricLines } from './cell-metrics';

describe('cell metrics for CloudWatch (decision D98)', () => {
  it('writes the cell’s minute and each queue’s as embedded metric lines', () => {
    const at = new Date('2026-10-26T06:30:00Z');
    const lines = cellMetricLines(
      {
        requests: 120,
        errors: 2,
        points: 900,
        latePoints: 15,
        queues: {
          imports: { waiting: 3, active: 1, delayed: 0, failed: 1, oldestWaitSeconds: 420 },
          exports: { waiting: 0, active: 0, delayed: 2, failed: 0, oldestWaitSeconds: null },
        },
        outbox: { backlog: 4, oldestSeconds: null },
        phones: { seen: 40, waiting: 6, parked: 1, oldestQueuedSeconds: 3_900 },
      },
      { namespace: 'thelamp/cell', cell: 'cell1', at },
    ).map((line) => JSON.parse(line));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      _aws: {
        Timestamp: at.getTime(),
        CloudWatchMetrics: [{ Namespace: 'thelamp/cell', Dimensions: [['Cell']] }],
      },
      Cell: 'cell1',
      Reported: 1,
      ServerErrors: 2,
      QueueWaiting: 3,
      QueueOldestWaitSeconds: 420,
      OutboxOldestSeconds: 0,
      UploadOldestSeconds: 3_900,
    });
    expect(lines[0]._aws.CloudWatchMetrics[0].Metrics).toContainEqual({
      Name: 'UploadOldestSeconds',
      Unit: 'Seconds',
    });
    expect(lines[1]).toMatchObject({
      _aws: { CloudWatchMetrics: [{ Dimensions: [['Cell', 'Queue']] }] },
      Queue: 'imports',
      Waiting: 3,
      Failed: 1,
      OldestWaitSeconds: 420,
    });
  });
});
