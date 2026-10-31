import { describe, expect, it, jest } from '@jest/globals';
import type { OutboxItem } from '@thelamp/api-client/sync';
import { senders } from './outbox-kinds';

jest.mock('./photos', () => ({ photoSender: () => ({ send: async () => undefined }) }));

describe('the claim sender (decision D115)', () => {
  it("uploads the person's waiting points before the claim, so its tracked distance counts them", async () => {
    const calls: string[] = [];
    const flushPoints = jest.fn(async (owner: string) => {
      calls.push(`points ${owner}`);
    });
    const request = jest.fn(async (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      return {};
    });
    const sender = senders({ request } as never, flushPoints)['expense_claim.create']!;
    await sender.send({ id: 'c1' }, { owner: 'tenant:asha' } as OutboxItem);
    expect(calls).toEqual(['points tenant:asha', 'POST /v1/expense-claims']);
  });
});
