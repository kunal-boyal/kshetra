import { describe, expect, it } from 'vitest';
import { webhookData, webhookRetryDelay } from './webhooks';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 26, 0, minutes));

describe('webhooks (M20, decision D94)', () => {
  it('tells subscribers IDs, keys and statuses, never numbers or notes', () => {
    expect(
      webhookData('user.updated', {
        userId: '01a10000-0000-7000-8000-000000000001',
        phone: '+919000000001',
        status: 'active',
        authRevision: 3,
      }),
    ).toEqual({ userId: '01a10000-0000-7000-8000-000000000001', status: 'active' });
    const reviewed = webhookData('submission.reviewed', {
      submissionId: '01a10000-0000-7000-8000-000000000002',
      userId: '01a10000-0000-7000-8000-000000000001',
      formKey: 'visit',
      accountId: null,
      visitId: null,
      capturedAt: '2026-10-26T04:00:00.000Z',
      before: 'pending',
      status: 'rejected',
      auto: false,
      reviewerId: '01a10000-0000-7000-8000-000000000003',
      note: 'Blurred photo',
    });
    expect(reviewed).not.toHaveProperty('note');
    expect(reviewed).not.toHaveProperty('reviewerId');
  });

  it('tries again after 1, 5, 15, 60, 180, 360 and 720 minutes, within a day of the first', () => {
    expect(webhookRetryDelay(1, at(0), at(0))).toBe(60_000);
    expect(webhookRetryDelay(4, at(0), at(30))).toBe(3_600_000);
    expect(webhookRetryDelay(7, at(0), at(600))).toBe(720 * 60_000);
    // Past the seventh, or past a day, it gives up.
    expect(webhookRetryDelay(8, at(0), at(600))).toBeNull();
    expect(webhookRetryDelay(7, at(0), at(800))).toBeNull();
  });
});
