import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Home layouts per role (M18, decision D122). */

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

const MONTH = () => todayIn('Asia/Kolkata').slice(0, 7);

function as(token: string) {
  const call = (method: 'GET' | 'PUT' | 'PATCH', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    put: (url: string, payload: object) => call('PUT', url, payload),
    patch: (url: string, payload: object) => call('PATCH', url, payload),
  };
}

/** A tenant: its admin, a manager with Asha and Ravi under them in a region, each signed in. */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { admin: newPhone(), manager: newPhone(), asha: newPhone() };
  const admin = await world.user(tenantId, {
    phone: phones.admin,
    designation: 'head',
    role: 'tenant_admin',
  });
  const manager = await world.user(tenantId, {
    phone: phones.manager,
    designation: 'manager',
    role: 'manager',
    managerId: admin.id,
  });
  const asha = await world.user(tenantId, {
    phone: phones.asha,
    name: 'Asha Rao',
    designation: 'executive',
    managerId: manager.id,
  });
  const ravi = await world.user(tenantId, {
    name: 'Ravi Kumar',
    designation: 'executive',
    managerId: manager.id,
  });
  const north = await world.territory(tenantId, `N-${newId().slice(-6)}`);
  await world.attach(tenantId, asha.id, north);
  const api = {
    admin: as((await world.signIn(phones.admin)).accessToken),
    manager: as((await world.signIn(phones.manager)).accessToken),
    asha: as((await world.signIn(phones.asha, newDevice())).accessToken),
  };
  const roles = (await api.admin.get('/v1/dashboard-layouts')).json().items as {
    role: { id: string; key: string };
    cards: unknown;
  }[];
  const roleId = (key: string) => roles.find((row) => row.role.key === key)!.role.id;
  return { tenantId, admin, manager, asha, ravi, north, api, roleId };
}

const LAYOUT = [
  { kind: 'tiles', metrics: ['visits', 'customers_covered'] },
  { kind: 'trend', metrics: ['visits'] },
  { kind: 'breakdown', metric: 'visits', by: 'person' },
  { kind: 'breakdown', metric: 'visits', by: 'territory', level: 'region' },
  { kind: 'waiting' },
];

describe('Home layouts (D122)', () => {
  it("shows a role's Home as its admin laid it out, within each viewer's scope", async () => {
    const t = await tenant('Laid Co');
    const set = await t.api.admin.put(`/v1/dashboard-layouts/${t.roleId('manager')}`, {
      cards: LAYOUT,
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ cards: LAYOUT, updatedAt: expect.any(String) });

    const home = (await t.api.manager.get(`/v1/dashboard?period=${MONTH()}`)).json();
    expect(home.layout).toEqual(LAYOUT);
    expect(home.tiles.map((tile: { metric: { key: string } }) => tile.metric.key)).toEqual([
      'visits',
      'customers_covered',
    ]);
    expect(home.trend.map((line: { key: string }) => line.key)).toEqual(['visits']);
    expect(home.metrics.map((metric: { key: string }) => metric.key)).toEqual(['visits']);
    // Without a leaderboard card, none is read.
    expect(home.leaderboard).toBeNull();
    const [people, places] = home.breakdowns;
    expect(people).toMatchObject({ metric: 'visits', by: 'person', level: null });
    expect(people.rows.map((row: { label: string }) => row.label).sort()).toEqual([
      'Asha Rao',
      'Ravi Kumar',
    ]);
    // Asha sits in the region; Ravi in none, a row of his own.
    expect(places.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: t.north, label: expect.stringContaining('N-') }),
        expect.objectContaining({ id: null, label: null }),
      ]),
    );

    // A role without a layout keeps the standard Home.
    const own = (await t.api.asha.get(`/v1/dashboard?period=${MONTH()}`)).json();
    expect(own).toMatchObject({ layout: null, breakdowns: [] });
  });

  it('refuses a layout naming what is not there, and anyone without the permission', async () => {
    const t = await tenant('Checked Co');
    const wrong = await t.api.admin.put(`/v1/dashboard-layouts/${t.roleId('manager')}`, {
      cards: [
        { kind: 'trend', metrics: ['customers_covered'] },
        { kind: 'breakdown', metric: 'visits', by: 'territory', level: 'galaxy' },
      ],
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.details).toEqual([
      expect.objectContaining({ path: 'cards[0].metrics[0]' }),
      expect.objectContaining({ path: 'cards[1].level' }),
    ]);
    expect(
      (
        await t.api.manager.put(`/v1/dashboard-layouts/${t.roleId('manager')}`, {
          cards: LAYOUT,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await t.api.admin.put(`/v1/dashboard-layouts/${newId()}`, { cards: LAYOUT })).statusCode,
    ).toBe(404);
  });

  it('falls back to the standard Home while the module is off, or once reset', async () => {
    const t = await tenant('Fallback Co');
    const path = `/v1/dashboard-layouts/${t.roleId('manager')}`;
    expect((await t.api.admin.put(path, { cards: LAYOUT })).statusCode).toBe(200);
    expect(
      (await t.api.admin.patch('/v1/settings', { modulesOff: ['advanced_analytics'] })).statusCode,
    ).toBe(200);
    expect((await t.api.manager.get(`/v1/dashboard?period=${MONTH()}`)).json().layout).toBeNull();
    expect((await t.api.admin.patch('/v1/settings', { modulesOff: [] })).statusCode).toBe(200);
    expect((await t.api.manager.get(`/v1/dashboard?period=${MONTH()}`)).json().layout).toEqual(
      LAYOUT,
    );
    const reset = await t.api.admin.put(path, { cards: null });
    expect(reset.json()).toMatchObject({ cards: null });
    const home = (await t.api.manager.get(`/v1/dashboard?period=${MONTH()}`)).json();
    expect(home.layout).toBeNull();
    expect(home.tiles.length).toBeGreaterThan(0);
  });
});
