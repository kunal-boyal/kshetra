import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId, type SyncPullResult } from '@kshetra/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devices, users } from '../src/db/schema/iam';
import { SyncTombstones } from '../src/modules/sync/tombstones';
import { Database } from '../src/platform/database';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** The pull side of the mobile sync (spec 11.3, decision D40), against real PostgreSQL. */

let app: NestFastifyApplication;
let world: World;

beforeAll(async () => {
  app = await startApp(testConfig());
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

interface Pulled extends SyncPullResult {
  status: number;
}

async function pull(
  token: string,
  entities: string,
  cursor?: string,
  limit?: number,
): Promise<Pulled> {
  const query = new URLSearchParams({ entities });
  if (cursor) query.set('cursor', cursor);
  if (limit) query.set('limit', String(limit));
  const reply = await app.inject({
    method: 'GET',
    url: `/v1/sync/pull?${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: reply.statusCode, ...reply.json() };
}

/** Pulls until no entity has more, as the phone does; returns every page. */
async function pullAll(token: string, entities: string, cursor?: string, limit?: number) {
  const pages: Pulled[] = [];
  let next = cursor;
  for (;;) {
    const page = await pull(token, entities, next, limit);
    expect(page.status).toBe(200);
    pages.push(page);
    next = page.cursor;
    if (!page.more) return { pages, cursor: page.cursor };
  }
}

const userIds = (pages: Pulled[]) =>
  pages.flatMap((page) => page.entities.users!.rows.map((row) => row.id));

/**
 * Pulls until a pull sends nothing. A cursor stops short of transactions still running anywhere
 * in the database, such as other test files', so the pull after one may send a row again; once a
 * pull is quiet, the next sends exactly what was written after it.
 */
async function settle(token: string, entities: string, cursor: string): Promise<Pulled> {
  let next = cursor;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const page = await pull(token, entities, next);
    const quiet = Object.values(page.entities).every(
      (entity) => entity.rows.length === 0 && entity.removed.length === 0,
    );
    if (quiet && !page.more) return page;
    next = page.cursor;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('The sync never went quiet.');
}

interface EntityShape {
  version: number;
  since: number;
  sinceAt: number;
}

interface CursorShape {
  epoch: string;
  entities: { users: EntityShape; territories: EntityShape };
}

function editCursor(cursor: string, edit: (state: CursorShape) => void): string {
  const state = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorShape;
  edit(state);
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

async function rename(tenantId: string, userId: string, name: string) {
  await app.get(Database).forTenant(tenantId, (tx) =>
    tx
      .update(users)
      .set({ name })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId))),
  );
}

/** A tenant with an admin, a manager with a report who has a report, and a field user elsewhere. */
async function team(name: string) {
  const tenantId = await world.tenant(name);
  const admin = await world.user(tenantId, { designation: 'head', role: 'tenant_admin' });
  const manager = await world.user(tenantId, { managerId: admin.id });
  const lead = await world.user(tenantId, { managerId: manager.id });
  const report = await world.user(tenantId, { designation: 'executive', managerId: lead.id });
  const loner = await world.user(tenantId, { designation: 'executive', managerId: admin.id });
  const token = async (phone: string | null) => (await world.signIn(phone!)).accessToken;
  return { tenantId, admin, manager, lead, report, loner, token };
}

describe('a first pull', () => {
  it("is a full pass of what the caller's scope reaches, and the whole territory tree", async () => {
    const t = await team('Full Pass Foods');
    const north = await world.territory(t.tenantId, 'NORTH');
    const delhi = await world.territory(t.tenantId, 'DELHI', north);

    const managers = await pullAll(await t.token(t.manager.phone), 'users,territories');
    const first = managers.pages[0]!;
    expect(first.entities.users).toMatchObject({
      pass: 'full',
      first: true,
      done: true,
      removed: [],
    });
    expect(userIds(managers.pages).sort()).toEqual([t.manager.id, t.lead.id, t.report.id].sort());
    expect(first.entities.users!.rows.find((row) => row.id === t.report.id)).toEqual({
      id: t.report.id,
      code: t.report.code,
      name: t.report.name,
      phone: t.report.phone,
      designation: 'executive',
      role: 'field_user',
      managerId: t.lead.id,
      status: 'active',
    });
    expect(first.entities.territories!.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: north, parentId: null, code: 'NORTH', active: true }),
        expect.objectContaining({ id: delhi, parentId: north, code: 'DELHI' }),
      ]),
    );

    // Someone who may not view users keeps only themselves; an admin keeps everyone.
    // Field users may use only the app, so they sign in on a phone.
    const onPhone = await world.signIn(t.report.phone!, newDevice());
    const field = await pullAll(onPhone.accessToken, 'users');
    expect(userIds(field.pages)).toEqual([t.report.id]);
    const admin = await pullAll(await t.token(t.admin.phone), 'users');
    expect(userIds(admin.pages)).toHaveLength(5);
  });

  it('spans pages when there is more than a page, sending every row once', async () => {
    const t = await team('Paged Provisions');
    const { pages } = await pullAll(await t.token(t.admin.phone), 'users', undefined, 2);
    expect(pages.map((page) => [page.entities.users!.first, page.entities.users!.done])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
    expect(pages.map((page) => page.more)).toEqual([true, true, false]);
    const ids = userIds(pages);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });
});

describe('the next pull', () => {
  it('sends only what changed since, in a changes pass', async () => {
    const t = await team('Changes Chai');
    const token = await t.token(t.manager.phone);
    const { cursor } = await pullAll(token, 'users,territories');

    const quiet = await settle(token, 'users,territories', cursor);
    expect(quiet.entities.users).toEqual({
      pass: 'changes',
      first: true,
      done: true,
      rows: [],
      removed: [],
    });

    await rename(t.tenantId, t.report.id, 'Renamed Report');
    const changed = await pull(token, 'users,territories', quiet.cursor);
    expect(changed.entities.users!.rows).toEqual([
      expect.objectContaining({ id: t.report.id, name: 'Renamed Report' }),
    ]);
    expect(changed.entities.territories!.rows).toEqual([]);
  });

  it('still sends a row whose slow transaction commits after a later one', async () => {
    const t = await team('Slow Spices');
    const token = await t.token(t.manager.phone);
    const { cursor } = await settle(token, 'users', (await pullAll(token, 'users')).cursor);

    // The slow transaction writes first, so it holds the older transaction ID, and commits last.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let written!: () => void;
    const wrote = new Promise<void>((resolve) => (written = resolve));
    const slow = app.get(Database).forTenant(t.tenantId, async (tx) => {
      await tx
        .update(users)
        .set({ name: 'Slow Writer' })
        .where(and(eq(users.tenantId, t.tenantId), eq(users.id, t.lead.id)));
      written();
      await gate;
    });
    await wrote;
    await rename(t.tenantId, t.report.id, 'Quick Writer');

    const during = await pull(token, 'users', cursor);
    expect(during.entities.users!.rows.map((row) => row.name)).toEqual(['Quick Writer']);

    release();
    await slow;
    const after = await pull(token, 'users', during.cursor);
    expect(after.entities.users!.rows.map((row) => row.name)).toContain('Slow Writer');
  });

  it('takes a full copy when people leave the scope without their rows changing', async () => {
    const t = await team('Moved Masalas');
    const managerToken = await t.token(t.manager.phone);
    const { cursor } = await pullAll(managerToken, 'users');

    // The lead moves to the admin's team, and the lead's report goes too: only the lead's row changes.
    const moved = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${t.lead.id}`,
      headers: { authorization: `Bearer ${await t.token(t.admin.phone)}` },
      payload: { managerId: t.admin.id },
    });
    expect(moved.statusCode).toBe(200);

    const next = await pullAll(managerToken, 'users', cursor);
    expect(next.pages[0]!.entities.users).toMatchObject({ pass: 'full', first: true });
    // The phone drops whatever the full pass didn't send: the lead and the report.
    expect(userIds(next.pages)).toEqual([t.manager.id]);
  });

  it('sends tombstones written since, in changes passes only', async () => {
    const t = await team('Tombstone Teas');
    const token = await t.token(t.admin.phone);
    const { cursor } = await settle(token, 'users', (await pullAll(token, 'users')).cursor);
    const gone = newId();
    await app
      .get(Database)
      .forTenant(t.tenantId, (tx) =>
        app.get(SyncTombstones).record(tx, t.tenantId, 'users', [gone]),
      );

    const changes = await pull(token, 'users', cursor);
    expect(changes.entities.users).toMatchObject({ pass: 'changes', rows: [], removed: [gone] });
    // It stops coming once the cursor passes it.
    await settle(token, 'users', changes.cursor);
    const fresh = await pullAll(token, 'users');
    expect(fresh.pages.flatMap((page) => page.entities.users!.removed)).toEqual([]);
  });

  it('takes a full copy of an entity whose layout changed, or whose copy is too old', async () => {
    const t = await team('Aged Atta');
    const token = await t.token(t.admin.phone);
    const { cursor } = await pullAll(token, 'users,territories');

    const relaid = editCursor(cursor, (state) => (state.entities.users.version = 0));
    const afterRelayout = await pull(token, 'users,territories', relaid);
    expect(afterRelayout.entities.users!.pass).toBe('full');
    expect(afterRelayout.entities.territories!.pass).toBe('changes');

    const aged = editCursor(cursor, (state) => {
      state.entities.territories.sinceAt -= 29 * 86_400;
    });
    const afterAgeing = await pull(token, 'users,territories', aged);
    expect(afterAgeing.entities.users!.pass).toBe('changes');
    expect(afterAgeing.entities.territories!.pass).toBe('full');
  });
});

describe('SYNC_RESET', () => {
  it('answers a cursor that is unreadable, from the future, or someone else’s', async () => {
    const t = await team('Reset Rice');
    const token = await t.token(t.admin.phone);
    const { cursor } = await pullAll(token, 'users');
    const reset = async (given: string, as = token) => {
      const reply = await app.inject({
        method: 'GET',
        url: `/v1/sync/pull?entities=users&cursor=${given}`,
        headers: { authorization: `Bearer ${as}` },
      });
      expect(reply.statusCode).toBe(410);
      expect(reply.json()).toMatchObject({ error: { code: 'SYNC_RESET' } });
    };
    await reset('not-a-cursor');
    await reset(editCursor(cursor, (state) => (state.entities.users.since = 2 ** 50)));
    await reset(editCursor(cursor, (state) => (state.epoch = 'another')));
    await reset(cursor, await t.token(t.manager.phone));
  });

  it('refuses an entity nobody provides, and a page too big', async () => {
    const t = await team('Strict Sugar');
    const token = await t.token(t.admin.phone);
    expect((await pull(token, 'users,orders')).status).toBe(400);
    expect((await pull(token, 'users', undefined, 501)).status).toBe(400);
  });
});

describe('the device heartbeat', () => {
  it("keeps the phone's latest health, with its clock skew", async () => {
    const t = await team('Heartbeat Honey');
    const device = newDevice('Field phone');
    const { accessToken } = await world.signIn(t.report.phone!, device);
    const body = {
      appVersion: '0.2.0',
      osVersion: '15',
      model: 'Field phone 2',
      permissions: { backgroundLocation: 'granted', notifications: 'denied' },
      batteryOptimised: true,
      queue: { queued: 3, parked: 1, oldestQueuedAt: '2026-10-07T09:00:00+05:30' },
      lastSyncAt: '2026-10-07T09:30:00+05:30',
    };
    const deviceTime = new Date(Date.now() + 15 * 60_000).toISOString();
    const beat = await app.inject({
      method: 'POST',
      url: '/v1/devices/heartbeat',
      headers: { authorization: `Bearer ${accessToken}`, 'x-device-time': deviceTime },
      payload: body,
    });
    expect(beat.statusCode).toBe(204);

    const [row] = await app
      .get(Database)
      .forTenant(t.tenantId, (tx) =>
        tx.select().from(devices).where(eq(devices.userId, t.report.id)),
      );
    expect(row).toMatchObject({ appVersion: '0.2.0', osVersion: '15', model: 'Field phone 2' });
    expect(row!.lastSeenAt).toBeInstanceOf(Date);
    const health = row!.health as Record<string, unknown>;
    expect(health).toMatchObject({ ...body, receivedAt: expect.any(String) });
    expect(health.clockSkewSeconds).toBeGreaterThan(14 * 60);
    expect(health.clockSkewSeconds).toBeLessThan(16 * 60);
  });

  it('is for phones only, and checks what it is sent', async () => {
    const t = await team('Web Walnuts');
    const web = await world.signIn(t.admin.phone!);
    const valid = {
      appVersion: '0.2.0',
      osVersion: '15',
      queue: { queued: 0, parked: 0, oldestQueuedAt: null },
      lastSyncAt: null,
    };
    const fromWeb = await app.inject({
      method: 'POST',
      url: '/v1/devices/heartbeat',
      headers: { authorization: `Bearer ${web.accessToken}` },
      payload: valid,
    });
    expect(fromWeb.json()).toMatchObject({ error: { code: 'USE_MOBILE_APP' } });

    const phone = await world.signIn(t.loner.phone!, newDevice());
    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/devices/heartbeat',
      headers: { authorization: `Bearer ${phone.accessToken}` },
      payload: { ...valid, queue: { queued: -1, parked: 0, oldestQueuedAt: null } },
    });
    expect(wrong.json()).toMatchObject({ error: { code: 'VALIDATION' } });
  });
});

describe('row versions', () => {
  it('are the transaction that last wrote the row', async () => {
    const tenantId = await world.tenant('Version Vadas');
    const person = await world.user(tenantId, { phone: newPhone() });
    const [row] = await app.get(Database).forTenant(tenantId, async (tx) => {
      await tx.update(users).set({ name: 'Versioned' }).where(eq(users.id, person.id));
      return (
        await tx.execute<{ version: string; current: string }>(
          sql`select row_version::text as version, pg_current_xact_id()::text as current
                from cell.users where tenant_id = ${tenantId} and id = ${person.id}`,
        )
      ).rows;
    });
    expect(row!.version).toBe(row!.current);
  });
});
