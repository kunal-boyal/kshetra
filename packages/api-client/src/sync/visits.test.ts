import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './local-schema';
import { nodeSqlite } from './node-sqlite';
import type { SqlDatabase } from './sql';
import { VISIT_IDLE_MS, Visits } from './visits';

const ME = 'tenant-a:user-a';
const SHOP = '01a10000-0000-7000-8000-0000000000a1';
const OTHER_SHOP = '01a10000-0000-7000-8000-0000000000a2';
const SHIFT = '01a10000-0000-7000-8000-0000000000c1';

let db: SqlDatabase;
let now: number;
let visits: Visits;

beforeEach(async () => {
  db = nodeSqlite();
  await migrate(db);
  now = Date.parse('2026-10-14T09:00:00Z');
  visits = new Visits(db, () => now);
});

const open = (visitId: string, accountId: string) =>
  db.transaction((tx) =>
    visits.open(tx, { owner: ME, visitId, accountId, shiftId: SHIFT, checkedInAt: now }),
  );

describe('the open visit on the phone (M6)', () => {
  it('opens one visit at a time; checking in elsewhere replaces it', async () => {
    await open('v1', SHOP);
    expect(await visits.current(ME)).toMatchObject({ visitId: 'v1', accountId: SHOP });
    now += 60_000;
    await open('v2', OTHER_SHOP);
    expect(await visits.current(ME)).toMatchObject({ visitId: 'v2', accountId: OTHER_SHOP });
    await db.transaction((tx) => visits.close(tx, ME));
    expect(await visits.current(ME)).toBeNull();
  });

  it('ends a visit left idle for 4 hours, counting from its latest submission', async () => {
    await open('v1', SHOP);
    now += 3 * 3_600_000;
    await db.transaction((tx) => visits.touch(tx, ME, 'v1', now));
    now += VISIT_IDLE_MS - 1_000;
    expect(await visits.current(ME)).not.toBeNull();
    now += 2_000;
    expect(await visits.current(ME)).toBeNull();
  });
});
