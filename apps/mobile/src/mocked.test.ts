import { describe, expect, it, jest } from '@jest/globals';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import { migrate, Outbox } from '@thelamp/api-client/sync';
import { MOCK_REPORT_EVERY_MS, reportMocked } from './mocked';
import { senders } from './outbox-kinds';

jest.mock('./photos', () => ({ photoSender: () => ({ send: async () => undefined }) }));

const OWNER = 'tenant-a:asha';
const T = Date.parse('2026-11-01T06:00:00Z');

async function phone() {
  const db = nodeSqlite();
  await migrate(db);
  return { db, outbox: new Outbox(db, {}) };
}

const reports = async (sync: Awaited<ReturnType<typeof phone>>) =>
  (await sync.outbox.items(OWNER)).map((item) => item.payload);

describe('reports of mocked fixes (BR-50, decision D119)', () => {
  it('reports the first in an hour at once, and counts the rest into the next report', async () => {
    const sync = await phone();
    expect(await reportMocked(sync, OWNER, 'tracking', 3, T)).toBe(true);
    expect(await reportMocked(sync, OWNER, 'tracking', 2, T + 10 * 60_000)).toBe(false);
    expect(await reportMocked(sync, OWNER, 'tracking', 1, T + 59 * 60_000)).toBe(false);
    expect(await reports(sync)).toEqual([
      { id: expect.any(String), seenAt: new Date(T).toISOString(), source: 'tracking', count: 3 },
    ]);
    // An hour on, the next report carries what was held back.
    expect(await reportMocked(sync, OWNER, 'tracking', 1, T + MOCK_REPORT_EVERY_MS)).toBe(true);
    expect((await reports(sync))[1]).toMatchObject({ source: 'tracking', count: 4 });
  });

  it('keeps each source and person to its own hour, and never holds a place', async () => {
    const sync = await phone();
    await reportMocked(sync, OWNER, 'form', 1, T);
    await reportMocked(sync, OWNER, 'punch', 1, T + 60_000);
    await reportMocked(sync, OWNER, 'form', 1, T + 120_000);
    await reportMocked(sync, 'tenant-a:ravi', 'form', 1, T + 120_000);
    expect((await reports(sync)).map((payload) => (payload as { source: string }).source)).toEqual([
      'form',
      'punch',
    ]);
    expect(await sync.outbox.items('tenant-a:ravi')).toHaveLength(1);
    expect(JSON.stringify(await reports(sync))).not.toMatch(/lat|lng/);
  });

  it('uploads a report to the route that keeps it', async () => {
    const request = jest.fn(async () => ({}));
    const payload = { id: 'r1', seenAt: new Date(T).toISOString(), source: 'visit', count: 1 };
    await senders({ request } as never)['mock_location.report']!.send(payload, {} as never);
    expect(request).toHaveBeenCalledWith('POST', '/v1/locations/mocked', expect.anything(), {
      body: payload,
    });
  });
});
