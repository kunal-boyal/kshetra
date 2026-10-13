import type { SyncEntity, SyncPullResult, SyncTerritory, SyncUser } from '@kshetra/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../client';
import { localRows, migrate } from './local-schema';
import { nodeSqlite } from './node-sqlite';
import { backoff, Outbox, type OutboxSender } from './outbox';
import { clearReferenceData, pull, readCache, readState, writeCache } from './pull';
import { SyncRunner } from './runner';
import type { SqlDatabase } from './sql';

const OWNER = 'tenant-a:user-a';

let db: SqlDatabase;
let now: number;
const clock = () => now;

beforeEach(async () => {
  db = nodeSqlite();
  await migrate(db);
  now = Date.parse('2026-10-07T09:00:00Z');
});

const user = (id: string, name = `Person ${id}`): SyncUser => ({
  id,
  code: `C${id}`,
  name,
  phone: null,
  designation: 'executive',
  role: 'field_user',
  managerId: null,
  status: 'active',
});

const territory = (id: string): SyncTerritory => ({
  id,
  parentId: null,
  level: 1,
  code: id,
  name: id,
  active: true,
});

type Page = NonNullable<SyncPullResult['entities']['users']>;

function page(
  entities: { users?: Page; territories?: SyncPullResult['entities']['territories'] },
  cursor: string,
  more = false,
): SyncPullResult {
  return { entities, cursor, more };
}

const full = (rows: SyncUser[], first = true, done = true): Page => ({
  pass: 'full',
  first,
  done,
  rows,
  removed: [],
});

const changes = (rows: SyncUser[], removed: string[] = []): Page => ({
  pass: 'changes',
  first: true,
  done: true,
  rows,
  removed,
});

/** A server that answers each pull with the next page given, recording the cursors it was sent. */
function server(...answers: (SyncPullResult | Error)[]) {
  const cursors: (string | undefined)[] = [];
  const client = {
    syncPull: vi.fn(async (_entities: readonly SyncEntity[], cursor?: string) => {
      cursors.push(cursor);
      const answer = answers.shift();
      if (!answer) throw new Error('No more answers.');
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  };
  return { client, cursors };
}

describe('the local database', () => {
  it('migrates once, to the latest version', async () => {
    await migrate(db);
    expect(await db.get('PRAGMA user_version')).toEqual({ user_version: 4 });
    const tables = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(tables.map((table) => table.name)).toEqual([
      'form_entries',
      'location_buffer',
      'outbox',
      'ref_accounts',
      'ref_contacts',
      'ref_items',
      'ref_territories',
      'ref_users',
      'shift_state',
      'sync_state',
    ]);
  });
});

describe('pull', () => {
  it('keeps every page of a full pass, with the cursor after each', async () => {
    const { client, cursors } = server(
      page({ users: full([user('1'), user('2')], true, false) }, 'c1', true),
      page(
        {
          users: full([user('3')], false, true),
          territories: {
            pass: 'full',
            first: true,
            done: true,
            rows: [territory('north')],
            removed: [],
          },
        },
        'c2',
      ),
    );
    await pull(db, client, ['users', 'territories'], OWNER, clock);
    expect(cursors).toEqual([undefined, 'c1']);
    expect((await localRows(db, 'users')).map((row) => row.id)).toEqual(['1', '2', '3']);
    expect(await localRows(db, 'territories')).toEqual([territory('north')]);
    expect(await readState(db, 'cursor')).toBe('c2');
    expect(await readState(db, 'pulled_at')).toBe(String(now));
    expect(await readState(db, 'full_refresh_at')).toBe(String(now));
  });

  it('drops what a later full pass does not send, and what a changes pass removes', async () => {
    await pull(
      db,
      server(page({ users: full([user('1'), user('2'), user('3')]) }, 'c1')).client,
      ['users'],
      OWNER,
      clock,
    );

    await pull(
      db,
      server(page({ users: changes([user('2', 'Renamed')], ['3']) }, 'c2')).client,
      ['users'],
      OWNER,
      clock,
    );
    expect(await localRows(db, 'users')).toEqual([user('1'), user('2', 'Renamed')]);

    // The scope changed: a full pass over two pages that sends only person 2.
    await pull(
      db,
      server(
        page({ users: full([], true, false) }, 'c3', true),
        page({ users: full([user('2')], false, true) }, 'c4'),
      ).client,
      ['users'],
      OWNER,
      clock,
    );
    expect((await localRows(db, 'users')).map((row) => row.id)).toEqual(['2']);
  });

  it('keeps the old rows until a full pass ends, and resumes from the last page kept', async () => {
    await pull(
      db,
      server(page({ users: full([user('1'), user('2')]) }, 'c1')).client,
      ['users'],
      OWNER,
      clock,
    );
    const halfway = server(
      page({ users: full([user('2')], true, false) }, 'c2', true),
      new NetworkError('gone'),
    );
    await expect(pull(db, halfway.client, ['users'], OWNER, clock)).rejects.toThrow(NetworkError);
    // Person 1 isn't swept until the pass ends.
    expect((await localRows(db, 'users')).map((row) => row.id)).toEqual(['1', '2']);

    const rest = server(page({ users: full([], false, true) }, 'c3'));
    await pull(db, rest.client, ['users'], OWNER, clock);
    expect(rest.cursors).toEqual(['c2']);
    expect((await localRows(db, 'users')).map((row) => row.id)).toEqual(['2']);
  });

  it('starts again from the beginning on SYNC_RESET', async () => {
    await pull(
      db,
      server(page({ users: full([user('1')]) }, 'c1')).client,
      ['users'],
      OWNER,
      clock,
    );
    now += 60_000;
    const reset = server(
      new ApiError(410, 'SYNC_RESET', 'Start again.'),
      page({ users: full([user('2')]) }, 'c9'),
    );
    await pull(db, reset.client, ['users'], OWNER, clock);
    expect(reset.cursors).toEqual(['c1', undefined]);
    expect((await localRows(db, 'users')).map((row) => row.id)).toEqual(['2']);
    expect(await readState(db, 'full_refresh_at')).toBe(String(now));
  });

  it("clears someone else's data before pulling, and sign-out clears it but keeps the outbox", async () => {
    await pull(
      db,
      server(page({ users: full([user('1')]) }, 'c1')).client,
      ['users'],
      OWNER,
      clock,
    );
    const outbox = new Outbox(db, {}, clock);
    await outbox.enqueue(db, { id: 'item-1', owner: OWNER, kind: 'test', payload: {} });

    const other = server(page({ users: full([user('7')]) }, 'x1'));
    await pull(db, other.client, ['users'], 'tenant-b:user-b', clock);
    expect(other.cursors).toEqual([undefined]);
    expect((await localRows(db, 'users')).map((row) => row.id)).toEqual(['7']);

    await clearReferenceData(db);
    expect(await localRows(db, 'users')).toEqual([]);
    expect(await readState(db, 'cursor')).toBeNull();
    expect((await outbox.items(OWNER)).map((item) => item.id)).toEqual(['item-1']);
  });
});

describe('the cache for offline starts', () => {
  it('keeps a response for its owner, and drops it for anyone else or at sign-out', async () => {
    await writeCache(db, OWNER, 'config', { etag: '"1"' });
    expect(await readCache(db, OWNER, 'config')).toEqual({ etag: '"1"' });
    expect(await readCache(db, 'tenant-b:user-b', 'config')).toBeNull();

    await writeCache(db, 'tenant-b:user-b', 'me', { name: 'B' });
    expect(await readCache(db, OWNER, 'config')).toBeNull();
    await clearReferenceData(db);
    expect(await readCache(db, 'tenant-b:user-b', 'me')).toBeNull();
  });
});

describe('the outbox', () => {
  const sent: string[] = [];
  let failures: Record<string, Error[]>;
  const discarded: unknown[] = [];
  const sender: OutboxSender = {
    async send(_payload, item) {
      const failure = failures[item.id]?.shift();
      if (failure) throw failure;
      sent.push(item.id);
    },
    async discard(payload) {
      discarded.push(payload);
    },
  };
  let outbox: Outbox;

  beforeEach(() => {
    sent.length = 0;
    discarded.length = 0;
    failures = {};
    outbox = new Outbox(db, { test: sender }, clock);
  });

  const add = (id: string, dependsOn: string[] = [], owner = OWNER) =>
    outbox.enqueue(db, { id, owner, kind: 'test', payload: { id }, dependsOn });

  it('uploads in order and removes what went', async () => {
    await add('a');
    await add('b');
    expect(await outbox.counts(OWNER)).toEqual({ queued: 2, parked: 0, oldestAt: now });
    expect(await outbox.run(OWNER)).toEqual({ status: 'done' });
    expect(sent).toEqual(['a', 'b']);
    expect(await outbox.items(OWNER)).toEqual([]);
  });

  it('sends an item only after what it depends on', async () => {
    await add('visit', ['photo']);
    await add('photo');
    await outbox.run(OWNER);
    expect(sent).toEqual(['photo', 'visit']);
  });

  it('backs off after a transient failure and ends the run, so order is kept', async () => {
    await add('a');
    await add('b');
    failures.a = [new NetworkError('offline'), new ApiError(503, 'INTERNAL', 'Down')];

    const first = await outbox.run(OWNER);
    expect(first).toMatchObject({ status: 'waiting', until: now + 5_000 });
    expect(sent).toEqual([]);
    expect((await outbox.items(OWNER))[0]).toMatchObject({
      attempts: 1,
      lastErrorCode: 'NETWORK',
      state: 'queued',
    });

    // Too soon: nothing moves, and b doesn't overtake.
    expect(await outbox.run(OWNER)).toMatchObject({ status: 'waiting', until: now + 5_000 });
    now += 5_000;
    expect(await outbox.run(OWNER)).toMatchObject({ status: 'waiting', until: now + 10_000 });
    now += 10_000;
    expect(await outbox.run(OWNER)).toEqual({ status: 'done' });
    expect(sent).toEqual(['a', 'b']);
  });

  it('waits at most 15 minutes between tries, or longer when the server asks', async () => {
    expect([0, 1, 2, 7, 8, 30].map(backoff)).toEqual([
      5_000, 10_000, 20_000, 640_000, 900_000, 900_000,
    ]);
    await add('a');
    failures.a = [new ApiError(429, 'RATE_LIMITED', 'Slow down', [], 60)];
    expect(await outbox.run(OWNER)).toMatchObject({ status: 'waiting', until: now + 60_000 });
  });

  it('parks a refused item with the server message; what depends on it waits, the rest goes', async () => {
    await add('photo');
    await add('visit', ['photo']);
    await add('other');
    failures.photo = [new ApiError(400, 'PHOTO_REQUIRED', 'Take a photo.')];

    expect(await outbox.run(OWNER)).toEqual({ status: 'done' });
    expect(sent).toEqual(['other']);
    const [photo, visit] = await outbox.items(OWNER);
    expect(photo).toMatchObject({
      state: 'parked',
      lastErrorCode: 'PHOTO_REQUIRED',
      lastError: 'Take a photo.',
    });
    expect(visit).toMatchObject({ state: 'queued', attempts: 0 });
    expect(await outbox.counts(OWNER)).toMatchObject({ queued: 1, parked: 1 });

    await outbox.retry('photo');
    await outbox.run(OWNER);
    expect(sent).toEqual(['other', 'photo', 'visit']);
  });

  it('discards an item for good, parking what depended on it', async () => {
    await add('photo');
    await add('visit', ['photo']);
    failures.photo = [new ApiError(400, 'VALIDATION', 'Bad photo.')];
    await outbox.run(OWNER);

    await outbox.discard('photo');
    expect(discarded).toEqual([{ id: 'photo' }]);
    expect(await outbox.items(OWNER)).toEqual([
      expect.objectContaining({
        id: 'visit',
        state: 'parked',
        lastErrorCode: 'DEPENDENCY_DISCARDED',
      }),
    ]);
  });

  it('stops without counting a try when the session ends or the app must update', async () => {
    await add('a');
    failures.a = [new ApiError(401, 'SESSION_REVOKED', 'Sign in.')];
    expect(await outbox.run(OWNER)).toMatchObject({ status: 'stopped' });
    expect((await outbox.items(OWNER))[0]).toMatchObject({ attempts: 0, state: 'queued' });
  });

  it("parks a kind it can't send, and never sends someone else's items", async () => {
    await outbox.enqueue(db, { id: 'odd', owner: OWNER, kind: 'mystery', payload: {} });
    await add('theirs', [], 'tenant-b:user-b');
    expect(await outbox.run(OWNER)).toEqual({ status: 'done' });
    expect(sent).toEqual([]);
    expect(await outbox.items(OWNER)).toEqual([
      expect.objectContaining({ id: 'odd', state: 'parked', lastErrorCode: 'UNKNOWN_KIND' }),
    ]);
    expect(await outbox.items('tenant-b:user-b')).toHaveLength(1);
  });
});

describe('the sync runner', () => {
  it('pushes, then pulls, one run at a time, and runs again if asked mid-run', async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const outbox = new Outbox(
      db,
      {
        test: {
          send: async () => {
            order.push('push');
            await held;
          },
        },
      },
      clock,
    );
    await outbox.enqueue(db, { id: 'a', owner: OWNER, kind: 'test', payload: {} });
    const client = {
      syncPull: vi.fn(async () => {
        order.push('pull');
        return page({ users: full([user('1')]) }, `c${order.length}`);
      }),
    };
    const runner = new SyncRunner({
      db,
      client,
      outbox,
      entities: ['users'],
      owner: () => OWNER,
      clock,
    });
    const seen: boolean[] = [];
    runner.subscribe((status) => seen.push(status.running));

    const first = runner.sync();
    const second = runner.sync();
    expect(second).toBe(first);
    release();
    await first;

    expect(order).toEqual(['push', 'pull', 'pull']);
    expect(runner.status).toMatchObject({
      running: false,
      offline: false,
      error: null,
      lastPulledAt: now,
      counts: { queued: 0, parked: 0, oldestAt: null },
    });
    expect(seen).toContain(true);
    runner.stop();
  });

  it('says when it is offline, and does nothing for nobody', async () => {
    const outbox = new Outbox(db, {}, clock);
    const client = { syncPull: vi.fn(async () => Promise.reject(new NetworkError('offline'))) };
    let owner: string | null = OWNER;
    const runner = new SyncRunner({
      db,
      client,
      outbox,
      entities: ['users'],
      owner: () => owner,
      clock,
    });
    await runner.sync();
    expect(runner.status).toMatchObject({ offline: true, error: null });

    owner = null;
    client.syncPull.mockClear();
    await runner.sync();
    expect(client.syncPull).not.toHaveBeenCalled();
    runner.stop();
  });
});
