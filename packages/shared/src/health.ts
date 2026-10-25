/**
 * Health per cell (module M22, spec 14.6, decision D93): what each cell reports every minute, and
 * when a figure says something needs looking at. The limits follow spec 14.6's objectives and
 * alarms.
 */

/** A cell that hasn't reported for this long is not reporting. */
export const HEALTH_SILENT_MINUTES = 3;

export const HEALTH_LIMITS = {
  /** Of requests answered with a server error (spec 14.6: 5xx above 2%). */
  errorRate: 0.02,
  /** Below this many requests a minute, a few errors say little. */
  minRequests: 50,
  /** The oldest job waiting in a queue (spec 14.6: queue wait under 5 minutes). */
  queueWaitSeconds: 300,
  /** The oldest event the outbox hasn't delivered. */
  outboxSeconds: 300,
  /** The oldest upload still waiting on a phone seen in the last half hour. */
  syncSeconds: 3600,
  /** A point counts as late once it arrives this long after it was captured. */
  lateSeconds: 120,
} as const;

export interface QueueFigures {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  /** How long the oldest waiting job has waited; null when none waits. */
  oldestWaitSeconds: number | null;
}

/** One minute of a cell. */
export interface CellFigures {
  requests: number;
  /** Requests answered with a server error. */
  errors: number;
  /** Location points accepted, and those that arrived late. */
  points: number;
  latePoints: number;
  queues: Record<string, QueueFigures>;
  outbox: { backlog: number; oldestSeconds: number | null };
  /** Phones heard from in the last half hour: with uploads waiting, refused, and the oldest. */
  phones: { seen: number; waiting: number; parked: number; oldestQueuedSeconds: number | null };
}

export const HEALTH_ISSUES = ['silent', 'errors', 'queue', 'outbox', 'sync'] as const;
export type HealthIssueKey = (typeof HEALTH_ISSUES)[number];

export interface HealthIssue {
  key: HealthIssueKey;
  /** The queue, for a queue that waits too long. */
  queue?: string;
}

/** What needs looking at in a cell's latest minute, or that it has gone quiet. */
export function healthIssues(
  latest: { at: Date; figures: CellFigures } | null,
  now: Date,
): HealthIssue[] {
  if (!latest || now.getTime() - latest.at.getTime() > HEALTH_SILENT_MINUTES * 60_000) {
    return [{ key: 'silent' }];
  }
  const { figures } = latest;
  const issues: HealthIssue[] = [];
  if (
    figures.requests >= HEALTH_LIMITS.minRequests &&
    figures.errors / figures.requests > HEALTH_LIMITS.errorRate
  ) {
    issues.push({ key: 'errors' });
  }
  for (const [queue, counts] of Object.entries(figures.queues)) {
    if ((counts.oldestWaitSeconds ?? 0) > HEALTH_LIMITS.queueWaitSeconds) {
      issues.push({ key: 'queue', queue });
    }
  }
  if ((figures.outbox.oldestSeconds ?? 0) > HEALTH_LIMITS.outboxSeconds)
    issues.push({ key: 'outbox' });
  if ((figures.phones.oldestQueuedSeconds ?? 0) > HEALTH_LIMITS.syncSeconds) {
    issues.push({ key: 'sync' });
  }
  return issues;
}
