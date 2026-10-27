import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TrailsService } from '../src/modules/field/trails.service';
import { Database } from '../src/platform/database';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Maps (M17): the live map, account pins, the day replay and visit density. */

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

const MIN = 60_000;
const H = 60 * MIN;
const HERE = { lat: 28.6315, lng: 77.2167 };
const NEAR = { lat: 28.6355, lng: 77.2167 };
const TODAY = () => todayIn('Asia/Kolkata');

function as(token: string) {
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object) => call('POST', url, payload),
  };
}

type Api = ReturnType<typeof as>;

async function admin(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: inject('databaseUrls').admin });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

const fix = (at: number, location = HERE) => ({
  location,
  accuracy: 15,
  mocked: false,
  capturedAt: new Date(at).toISOString(),
});

const point = (shiftId: string, at: number, location = HERE, accuracy = 12) => ({
  id: newId(),
  shiftId,
  capturedAt: new Date(at).toISOString(),
  location,
  accuracy,
  mocked: false,
  source: 'background',
});

/**
 * A tenant with its admin, a manager with Asha reporting to them, Ravi reporting to the admin,
 * and a shop Asha looks after at HERE. Asha punched in an hour ago.
 */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { admin: newPhone(), manager: newPhone(), asha: newPhone(), ravi: newPhone() };
  const adminUser = await world.user(tenantId, {
    phone: phones.admin,
    designation: 'head',
    role: 'tenant_admin',
  });
  const manager = await world.user(tenantId, {
    phone: phones.manager,
    designation: 'manager',
    role: 'manager',
    managerId: adminUser.id,
  });
  const asha = await world.user(tenantId, {
    phone: phones.asha,
    designation: 'executive',
    managerId: manager.id,
  });
  const ravi = await world.user(tenantId, {
    phone: phones.ravi,
    designation: 'executive',
    managerId: adminUser.id,
  });
  const api = {
    admin: as((await world.signIn(phones.admin)).accessToken),
    manager: as((await world.signIn(phones.manager)).accessToken),
    asha: as((await world.signIn(phones.asha, newDevice())).accessToken),
    ravi: as((await world.signIn(phones.ravi, newDevice())).accessToken),
  };
  const shop = newId();
  const made = await api.admin.post('/v1/accounts', {
    id: shop,
    type: 'customer',
    code: `C-${newId().slice(-8)}`,
    name: 'Sharma Stores',
    territoryId: await world.territory(tenantId, `T-${newId().slice(-6)}`),
    location: HERE,
    slots: { executive: asha.id },
  });
  expect(made.statusCode).toBe(201);
  // An hour ago, unless the hour after it crosses midnight in India: then three hours ago, so the
  // shift, its fixes and its visits fall on one day of the tenant's clock.
  const day = (ms: number) => todayIn('Asia/Kolkata', new Date(ms));
  const start =
    day(Date.now() - H) === day(Date.now() - H + 45 * 60_000) ? Date.now() - H : Date.now() - 3 * H;
  const shiftId = newId();
  const opened = await api.asha.post('/v1/shifts', {
    id: shiftId,
    startedAt: new Date(start).toISOString(),
    location: HERE,
    accuracy: 15,
    mocked: false,
    consentVersion: '2026-10',
  });
  expect(opened.statusCode).toBe(201);
  return { tenantId, manager, asha, ravi, api, shop, shiftId, start };
}

async function walk(api: Api, shiftId: string, start: number) {
  const batch = await api.post('/v1/locations/batch', {
    points: [
      point(shiftId, start + 5 * MIN),
      point(shiftId, start + 10 * MIN, NEAR),
      point(shiftId, start + 12 * MIN, NEAR, 180),
      point(shiftId, start + 30 * MIN, HERE),
    ],
  });
  expect(batch.json().accepted).toHaveLength(4);
}

describe('the live map (M17)', () => {
  it('shows who is on duty in scope, where they were last seen, and their visit', async () => {
    const t = await tenant('Live Co');
    await walk(t.api.asha, t.shiftId, t.start);
    const visit = await t.api.asha.post('/v1/visits', {
      id: newId(),
      accountId: t.shop,
      checkedInAt: new Date().toISOString(),
      fix: fix(Date.now()),
    });
    expect(visit.statusCode).toBe(201);

    const live = (await t.api.manager.get('/v1/live')).json();
    expect(live.people).toEqual([
      expect.objectContaining({
        user: expect.objectContaining({ id: t.asha.id }),
        shiftId: t.shiftId,
        paused: false,
        position: HERE,
        seenAt: new Date(t.start + 30 * MIN).toISOString(),
        visit: expect.objectContaining({ account: expect.objectContaining({ id: t.shop }) }),
      }),
    ]);
    // Ravi reports to the admin, outside the manager's team.
    expect((await t.api.admin.get('/v1/live')).json().people).toHaveLength(1);
    expect((await t.api.asha.get('/v1/live')).json().error.code).toBe('FORBIDDEN');
  });

  it('says how each person’s day goes against the plan, and when they are off it (decision D104)', async () => {
    const t = await tenant('Plan Co');
    const unplanned = (await t.api.manager.get('/v1/live')).json().people[0];
    expect(unplanned).toMatchObject({
      visits: { done: 0, planned: null },
      place: null,
      offPlan: false,
    });

    const planned = await t.api.asha.post('/v1/plan-items', {
      id: newId(),
      userId: t.asha.id,
      accountId: t.shop,
      date: todayIn('Asia/Kolkata'),
      purpose: 'Restock',
    });
    expect(planned.statusCode, planned.body).toBe(201);
    await walk(t.api.asha, t.shiftId, t.start);
    const visit = await t.api.asha.post('/v1/visits', {
      id: newId(),
      accountId: t.shop,
      checkedInAt: new Date().toISOString(),
      fix: fix(Date.now()),
    });
    expect(visit.statusCode).toBe(201);
    expect((await t.api.manager.get('/v1/live')).json().people[0]).toMatchObject({
      visits: { done: 1, planned: 1 },
      place: 'Sharma Stores',
      offPlan: false,
    });

    // Five kilometres north of the only planned shop: off the plan.
    const far = { lat: HERE.lat + 0.045, lng: HERE.lng };
    const moved = await t.api.asha.post('/v1/locations/batch', {
      points: [point(t.shiftId, t.start + 40 * MIN, far)],
    });
    expect(moved.json().accepted).toHaveLength(1);
    expect((await t.api.manager.get('/v1/live')).json().people[0]).toMatchObject({
      position: far,
      offPlan: true,
    });
  });

  it('pins the accounts the caller sees, marked once visited this month', async () => {
    const t = await tenant('Pins Co');
    const before = (await t.api.asha.get('/v1/account-pins')).json();
    expect(before.items).toEqual([
      expect.objectContaining({ id: t.shop, location: HERE, type: 'customer', visited: false }),
    ]);
    expect(before.truncated).toBe(false);
    await t.api.asha.post('/v1/visits', {
      id: newId(),
      accountId: t.shop,
      checkedInAt: new Date().toISOString(),
      fix: fix(Date.now()),
    });
    expect((await t.api.asha.get('/v1/account-pins')).json().items[0].visited).toBe(true);
    expect((await t.api.ravi.get('/v1/account-pins')).json().items).toEqual([]);
    expect((await t.api.asha.get('/v1/account-pins?period=2020-01')).json().items[0].visited).toBe(
      false,
    );
  });
});

describe('the day replay (M17)', () => {
  it('replays accurate fixes with gaps and visits, and the trail once the fixes are gone', async () => {
    const t = await tenant('Replay Co');
    await walk(t.api.asha, t.shiftId, t.start);
    await t.api.asha.post('/v1/visits', {
      id: newId(),
      accountId: t.shop,
      checkedInAt: new Date(t.start + 31 * MIN).toISOString(),
      fix: fix(t.start + 31 * MIN),
    });
    const url = `/v1/trails?userId=${t.asha.id}&date=${todayIn('Asia/Kolkata', new Date(t.start))}`;
    const day = (await t.api.manager.get(url)).json();
    expect(day.shifts).toHaveLength(1);
    const [shift] = day.shifts;
    expect(shift).toMatchObject({ id: t.shiftId, source: 'points', endedAt: null });
    // The 180 m fix is kept, but left out of the replay; the silence from 10 to 30 minutes is a gap.
    expect(shift.points.map((p: { at: string }) => p.at)).toEqual([
      new Date(t.start + 5 * MIN).toISOString(),
      new Date(t.start + 10 * MIN).toISOString(),
      new Date(t.start + 30 * MIN).toISOString(),
    ]);
    expect(shift.gaps).toEqual([
      {
        from: new Date(t.start + 10 * MIN).toISOString(),
        to: new Date(t.start + 30 * MIN).toISOString(),
      },
    ]);
    expect(shift.distanceM).toBeGreaterThan(800);
    expect(day.visits).toEqual([
      expect.objectContaining({
        account: expect.objectContaining({ id: t.shop }),
        geofence: 'inside',
        location: HERE,
      }),
    ]);

    // Once the shift is compacted and its raw fixes are gone, the trail stands in.
    const ended = await t.api.asha.post(`/v1/shifts/${t.shiftId}/end`, {
      location: HERE,
      accuracy: 15,
      mocked: false,
      endedAt: new Date(t.start + 40 * MIN).toISOString(),
    });
    expect(ended.statusCode).toBe(200);
    await app
      .get(Database)
      .forTenant(t.tenantId, (tx) => app.get(TrailsService).compact(tx, t.tenantId, t.shiftId));
    await admin('delete from cell.location_points where tenant_id = $1 and shift_id = $2', [
      t.tenantId,
      t.shiftId,
    ]);
    const later = (await t.api.manager.get(url)).json().shifts[0];
    expect(later).toMatchObject({ source: 'trail', endedAt: expect.any(String) });
    expect(later.points[0]).toMatchObject({ at: null });
    expect(later.points.length).toBeGreaterThanOrEqual(2);
    expect(later.gaps).toHaveLength(1);
  });

  it("shows a person's day only to those whose scope reaches them", async () => {
    const t = await tenant('Reach Co');
    // The shift's own day: started an hour ago, it falls on yesterday just after midnight.
    const day = `date=${todayIn('Asia/Kolkata', new Date(t.start))}`;
    expect(
      (await t.api.manager.get(`/v1/trails?userId=${t.ravi.id}&${day}`)).json().error.code,
    ).toBe('OUT_OF_SCOPE');
    expect((await t.api.manager.get(`/v1/trails?userId=${newId()}&${day}`)).json().error.code).toBe(
      'NOT_FOUND',
    );
    expect((await t.api.asha.get(`/v1/trails?userId=${t.asha.id}&${day}`)).json().error.code).toBe(
      'FORBIDDEN',
    );
    expect(
      (await t.api.manager.get(`/v1/trails?userId=${t.asha.id}&${day}`)).json().shifts,
    ).toHaveLength(1);
  });
});

describe('visit density (M17)', () => {
  it("counts the scope's check-ins on a grid of about a kilometre", async () => {
    const t = await tenant('Density Co');
    for (const location of [HERE, NEAR]) {
      const visit = newId();
      await t.api.asha.post('/v1/visits', {
        id: visit,
        accountId: t.shop,
        checkedInAt: new Date().toISOString(),
        fix: fix(Date.now(), location),
      });
      await t.api.asha.post(`/v1/visits/${visit}/check-out`, {
        checkedOutAt: new Date().toISOString(),
        fix: fix(Date.now(), location),
      });
    }
    const month = TODAY().slice(0, 7);
    const density = (await t.api.manager.get(`/v1/density?period=${month}`)).json();
    expect(density).toMatchObject({ period: month, cell: 0.01, visits: 2 });
    expect(density.cells).toEqual([expect.objectContaining({ visits: 2 })]);
    expect((await t.api.admin.get('/v1/density?period=2020-01')).json().cells).toEqual([]);
  });
});
