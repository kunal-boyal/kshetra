import type { Outbox, SqlDatabase } from '@thelamp/api-client/sync';
import { type MockLocationReportBody, type MockSource, newId } from '@thelamp/shared';

/** A source's mocked fixes are reported at most this often; the rest wait for the next report. */
export const MOCK_REPORT_EVERY_MS = 60 * 60_000;

/** When a source last reported, and how many it has held back since. */
interface Held {
  sentAt: number;
  held: number;
}

const stateKey = (owner: string, source: MockSource) => `mock_report:${owner}:${source}`;

/**
 * Notes mocked fixes the phone refused (BR-50, decision D119): the first in an hour for its
 * source is queued as a report at once, as `mock_location.report`; later ones in that hour are
 * counted and go with the next report. A report holds when, where in the app and how many, never
 * a place. Returns whether a report was queued.
 */
export async function reportMocked(
  sync: { db: SqlDatabase; outbox: Outbox },
  owner: string,
  source: MockSource,
  count = 1,
  now = Date.now(),
): Promise<boolean> {
  const key = stateKey(owner, source);
  return sync.db.transaction(async (tx) => {
    const row = await tx.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [
      key,
    ]);
    const last = row ? (JSON.parse(row.value) as Held) : null;
    const save = (held: Held) =>
      tx.run(
        'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        [key, JSON.stringify(held)],
      );
    if (last && now >= last.sentAt && now - last.sentAt < MOCK_REPORT_EVERY_MS) {
      await save({ sentAt: last.sentAt, held: last.held + count });
      return false;
    }
    const id = newId();
    const payload: MockLocationReportBody = {
      id,
      seenAt: new Date(now).toISOString(),
      source,
      count: Math.min(count + (last?.held ?? 0), 10_000),
    };
    await sync.outbox.enqueue(tx, { id, owner, kind: 'mock_location.report', payload });
    await save({ sentAt: now, held: 0 });
    return true;
  });
}
