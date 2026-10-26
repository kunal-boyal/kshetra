import type { CellFiguresShape } from '@thelamp/shared';

type Unit = 'Count' | 'Seconds';

/**
 * A minute of a cell's health as CloudWatch's embedded metric format (decision D98): one JSON line
 * for the cell and one per queue, which the container's log driver sends on and CloudWatch turns
 * into metrics, so no SDK or permission is needed. The alarms for queue backlogs, the outbox and
 * phones' uploads read them (spec 14.6).
 */
export function cellMetricLines(
  figures: CellFiguresShape,
  options: { namespace: string; cell: string; at: Date },
): string[] {
  const line = (
    dimensions: Record<string, string>,
    values: Record<string, [number, Unit]>,
  ): string =>
    JSON.stringify({
      _aws: {
        Timestamp: options.at.getTime(),
        CloudWatchMetrics: [
          {
            Namespace: options.namespace,
            Dimensions: [Object.keys(dimensions)],
            Metrics: Object.entries(values).map(([name, [, unit]]) => ({ Name: name, Unit: unit })),
          },
        ],
      },
      ...dimensions,
      ...Object.fromEntries(Object.entries(values).map(([name, [value]]) => [name, value])),
    });
  const queues = Object.entries(figures.queues);
  const oldest = Math.max(0, ...queues.map(([, queue]) => queue.oldestWaitSeconds ?? 0));
  return [
    line(
      { Cell: options.cell },
      {
        Reported: [1, 'Count'],
        Requests: [figures.requests, 'Count'],
        ServerErrors: [figures.errors, 'Count'],
        PointsAccepted: [figures.points, 'Count'],
        PointsLate: [figures.latePoints, 'Count'],
        QueueWaiting: [queues.reduce((sum, [, queue]) => sum + queue.waiting, 0), 'Count'],
        QueueOldestWaitSeconds: [oldest, 'Seconds'],
        OutboxBacklog: [figures.outbox.backlog, 'Count'],
        OutboxOldestSeconds: [figures.outbox.oldestSeconds ?? 0, 'Seconds'],
        PhonesWaiting: [figures.phones.waiting, 'Count'],
        UploadOldestSeconds: [figures.phones.oldestQueuedSeconds ?? 0, 'Seconds'],
      },
    ),
    ...queues.map(([name, queue]) =>
      line(
        { Cell: options.cell, Queue: name },
        {
          Waiting: [queue.waiting, 'Count'],
          Failed: [queue.failed, 'Count'],
          OldestWaitSeconds: [queue.oldestWaitSeconds ?? 0, 'Seconds'],
        },
      ),
    ),
  ];
}
