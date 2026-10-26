import type { EventPayload, EventType } from './events';

/**
 * Webhooks (module M20, spec 12.4, decision D94): which domain events a tenant's systems may
 * subscribe to, what each tells them, and when a failed delivery is tried again. Events carry
 * IDs, keys and statuses, never people's numbers or reviewers' notes: a system that wants more
 * reads it from the API with its own client.
 */

export const WEBHOOK_EVENTS = [
  'user.created',
  'user.updated',
  'user.deactivated',
  'account.created',
  'account.updated',
  'account.assignment_changed',
  'submission.created',
  'submission.reviewed',
  'order.placed',
  'order.status_changed',
] as const satisfies readonly EventType[];

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Sent by "Send a test", so a receiver can check its signature without waiting for a change. */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

/** What an event tells subscribers, from the payload the outbox carries. */
export function webhookData(
  type: WebhookEvent,
  payload: EventPayload<WebhookEvent>,
): Record<string, unknown> {
  switch (type) {
    case 'user.created':
    case 'user.updated':
    case 'user.deactivated': {
      const user = payload as EventPayload<'user.created'>;
      return { userId: user.userId, status: user.status };
    }
    case 'submission.created': {
      const submission = payload as EventPayload<'submission.created'>;
      return {
        submissionId: submission.submissionId,
        userId: submission.userId,
        formKey: submission.formKey,
        accountId: submission.accountId,
        visitId: submission.visitId,
        capturedAt: submission.capturedAt,
        status: submission.status,
      };
    }
    case 'submission.reviewed': {
      const reviewed = payload as EventPayload<'submission.reviewed'>;
      return {
        submissionId: reviewed.submissionId,
        userId: reviewed.userId,
        formKey: reviewed.formKey,
        accountId: reviewed.accountId,
        before: reviewed.before,
        status: reviewed.status,
        auto: reviewed.auto,
      };
    }
    case 'order.placed':
    case 'order.status_changed': {
      const order = payload as EventPayload<'order.placed'>;
      return {
        orderId: order.orderId,
        userId: order.userId,
        accountId: order.accountId,
        visitId: order.visitId,
        placedAt: order.placedAt,
        status: order.status,
      };
    }
    case 'account.created':
    case 'account.updated': {
      const account = payload as EventPayload<'account.created'>;
      return {
        accountId: account.accountId,
        typeKey: account.typeKey,
        code: account.code,
        status: account.status,
      };
    }
    case 'account.assignment_changed': {
      const assignment = payload as EventPayload<'account.assignment_changed'>;
      return {
        accountId: assignment.accountId,
        slot: assignment.slot,
        userId: assignment.userId,
        from: assignment.from,
      };
    }
  }
}

/** Minutes after each failed try before the next (spec M20: exponential backoff for 24 hours). */
export const WEBHOOK_RETRY_MINUTES = [1, 5, 15, 60, 180, 360, 720] as const;
export const WEBHOOK_RETRY_HOURS = 24;

/**
 * How long to wait before trying a message again after `failed` tries, or null when it has had
 * its tries or the next would fall more than a day after the first.
 */
export function webhookRetryDelay(failed: number, firstAt: Date, now: Date): number | null {
  const minutes = WEBHOOK_RETRY_MINUTES[failed - 1];
  if (minutes === undefined) return null;
  const next = now.getTime() + minutes * 60_000;
  if (next - firstAt.getTime() > WEBHOOK_RETRY_HOURS * 3_600_000) return null;
  return minutes * 60_000;
}
