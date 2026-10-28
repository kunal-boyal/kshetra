import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TransfersService } from '../src/modules/iam/transfers.service';
import { newDevice, newPhone, type NewUser, startApp, World } from './support';

/** People on the web (module M3): fields, filters, territories, transfers, the chart, history. */

let app: NestFastifyApplication;
let world: World;

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

interface Person {
  id: string;
  phone: string;
  code: string;
}

const text = (en: string) => ({ en, hi: en });
const today = () => todayIn('Asia/Kolkata');
const inDays = (days: number) =>
  new Date(Date.parse(`${today()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * A tenant with an admin and this tree:
 *
 *     head ── m ── f1
 *         │    └── f2
 *         └── p
 */
async function org(name: string) {
  const tenantId = await world.tenant(name);
  const make = async (input: NewUser): Promise<Person> => {
    const phone = newPhone();
    const user = await world.user(tenantId, { phone, ...input });
    return { id: user.id, phone, code: user.code };
  };
  const admin = await make({ name: 'Asha Admin', designation: 'head', role: 'tenant_admin' });
  const head = await make({ name: 'Hari Head', designation: 'head' });
  const m = await make({ name: 'Meena Manager', managerId: head.id });
  const p = await make({ name: 'Pooja Peer', managerId: head.id });
  const f1 = await make({ name: 'Farid Field', designation: 'executive', managerId: m.id });
  const f2 = await make({ name: 'Faye Field', designation: 'executive', managerId: m.id });
  return { tenantId, admin, head, m, p, f1, f2, make };
}

function as(token: string) {
  const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => send('GET', url),
    post: (url: string, payload?: object) => send('POST', url, payload),
    patch: (url: string, payload: object) => send('PATCH', url, payload),
    put: (url: string, payload: object) => send('PUT', url, payload),
  };
}

const web = async (person: Person) => as((await world.signIn(person.phone)).accessToken);
const error = (reply: { json: () => unknown }) =>
  (reply.json() as { error?: { code: string; details?: { path: string; issue: string }[] } }).error;

describe('custom user fields (spec 5.3)', () => {
  it("start from the template, and keep each key's type once used", async () => {
    const tenantId = await world.tenant('Field Farms', 'active', 'agri');
    const phone = newPhone();
    await world.user(tenantId, { phone, designation: 'business_head', role: 'tenant_admin' });
    const admin = as((await world.signIn(phone)).accessToken);
    const start = await admin.get('/v1/user-fields');
    expect(start.json().fields.map((field: { key: string }) => field.key)).toEqual(['hq']);

    const crops = {
      key: 'crops',
      type: 'multi_select',
      label: text('Crops'),
      options: [
        { key: 'paddy', label: text('Paddy') },
        { key: 'wheat', label: text('Wheat') },
      ],
    };
    const replaced = await admin.put('/v1/user-fields', { fields: [crops] });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().retired.map((field: { key: string }) => field.key)).toEqual(['hq']);

    const retyped = await admin.put('/v1/user-fields', {
      fields: [crops, { key: 'hq', type: 'number', label: text('HQ') }],
    });
    expect(error(retyped)?.details).toEqual([
      { path: 'fields[1].type', issue: '`hq` was a short_text field, and a key keeps its type' },
    ]);
    // Patterns run in linear time (decision D45), so one RE2 can't run is refused.
    const patterned = await admin.put('/v1/user-fields', {
      fields: [{ key: 'pin', type: 'short_text', label: text('PIN'), pattern: '(\\d)\\1' }],
    });
    expect(error(patterned)?.details).toEqual([
      {
        path: 'fields[0].pattern',
        issue:
          'This pattern is not valid, or uses lookarounds or backreferences, which can be slow',
      },
    ]);
    const back = await admin.put('/v1/user-fields', {
      fields: [crops, { key: 'hq', type: 'short_text', label: text('Head office') }],
    });
    expect(back.json().retired).toEqual([]);
  });

  it('check values on create, and only the values a change sends', async () => {
    const t = await org('Valued Ventures');
    const admin = await web(t.admin);
    await admin.put('/v1/user-fields', {
      fields: [
        { key: 'zone', type: 'short_text', label: text('Zone') },
        { key: 'acres', type: 'number', label: text('Acres'), max: 100 },
      ],
    });
    const created = await admin.post('/v1/users', {
      code: 'VV-9',
      name: 'Vimal Values',
      designation: 'executive',
      managerId: t.m.id,
      custom: { zone: ' North ', acres: '12' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().custom).toEqual({ zone: 'North', acres: 12 });

    const wrong = await admin.post('/v1/users', {
      code: 'VV-10',
      name: 'Wrong Values',
      designation: 'executive',
      managerId: t.m.id,
      custom: { acres: 500, colour: 'red' },
    });
    expect(error(wrong)?.details).toEqual([
      { path: 'custom.colour', issue: 'There is no such field' },
      { path: 'custom.acres', issue: 'Enter 100 or less' },
    ]);

    // A field made required later doesn't block an edit that leaves it alone.
    await admin.put('/v1/user-fields', {
      fields: [
        { key: 'zone', type: 'short_text', label: text('Zone') },
        { key: 'acres', type: 'number', label: text('Acres'), max: 100 },
        { key: 'beat', type: 'short_text', label: text('Beat'), required: true },
      ],
    });
    const id = created.json().id as string;
    const renamed = await admin.patch(`/v1/users/${id}`, { name: 'Vimal Renamed' });
    expect(renamed.statusCode).toBe(200);
    const cleared = await admin.patch(`/v1/users/${id}`, { custom: { zone: null, acres: 7 } });
    expect(cleared.json().custom).toEqual({ acres: 7 });
    const missing = await admin.patch(`/v1/users/${id}`, { custom: { beat: '' } });
    expect(error(missing)?.details).toEqual([{ path: 'custom.beat', issue: 'Fill this in' }]);
  });
});

describe('the people table', () => {
  it('finds people by name, code or number, by designation and by manager', async () => {
    const t = await org('Search Seeds');
    const admin = await web(t.admin);
    const names = async (query: string) =>
      ((await admin.get(`/v1/users?${query}`)).json().items as { name: string }[])
        .map((user) => user.name)
        .sort();
    expect(await names('q=field')).toEqual(['Farid Field', 'Faye Field']);
    expect(await names(`q=${encodeURIComponent(t.p.code)}`)).toEqual(['Pooja Peer']);
    expect(await names(`q=${t.m.phone.slice(-7)}`)).toEqual(['Meena Manager']);
    expect(await names('q=100%25')).toEqual([]);
    expect(await names('designation=executive')).toEqual(['Farid Field', 'Faye Field']);
    expect(await names(`managerId=${t.head.id}`)).toEqual(['Meena Manager', 'Pooja Peer']);

    // The first page counts people by status under the other filters (decision D104).
    const executives = (await admin.get('/v1/users?designation=executive&limit=1')).json();
    expect(executives.summary).toEqual({
      counts: { active: 2, inactive: 0 },
      seats: null,
    });
    expect(
      (await admin.get(`/v1/users?limit=1&cursor=${executives.nextCursor}`)).json().summary,
    ).toBeNull();

    // By territory: those attached today to it or one under it.
    const north = await world.territory(t.tenantId, `N-${newId().slice(-6)}`);
    const placed = await admin.post('/v1/users', {
      code: `SS-${newId().slice(-6)}`,
      name: 'Nina North',
      phone: newPhone(),
      designation: 'executive',
      managerId: t.m.id,
      territoryIds: [north],
    });
    expect(placed.statusCode, placed.body).toBe(201);
    expect(await names(`territoryId=${north}`)).toEqual(['Nina North']);
  });

  it("shows each person's manager, territories and phone, with its last heartbeat", async () => {
    const t = await org('Detail Dairies');
    const north = await world.territory(t.tenantId, 'NORTH');
    const admin = await web(t.admin);
    const created = await admin.post('/v1/users', {
      code: 'DD-1',
      name: 'Dev Detail',
      phone: newPhone(),
      designation: 'executive',
      managerId: t.m.id,
      territoryIds: [north],
    });
    expect(created.json()).toMatchObject({
      manager: { id: t.m.id, name: 'Meena Manager' },
      territories: [{ id: north, code: 'NORTH', name: 'NORTH' }],
    });
    const nowhere = await admin.post('/v1/users', {
      code: 'DD-2',
      name: 'Nowhere Nobody',
      designation: 'executive',
      managerId: t.m.id,
      territoryIds: [newId()],
    });
    expect(error(nowhere)?.details).toEqual([
      { path: 'territoryIds[0]', issue: 'There is no active territory with this ID' },
    ]);

    const phone = await world.signIn(t.f1.phone, newDevice('Field phone'));
    await app.inject({
      method: 'POST',
      url: '/v1/devices/heartbeat',
      headers: { authorization: `Bearer ${phone.accessToken}` },
      payload: {
        appVersion: '0.2.0',
        osVersion: '15',
        queue: { queued: 2, parked: 1, oldestQueuedAt: null },
        lastSyncAt: null,
      },
    });
    const detail = (await admin.get(`/v1/users/${t.f1.id}`)).json();
    expect(detail.device).toMatchObject({
      platform: 'android',
      model: 'Field phone',
      appVersion: '0.2.0',
      health: { queue: { queued: 2, parked: 1 } },
    });
    expect((await admin.get(`/v1/users/${t.f2.id}`)).json().device).toBeNull();

    const listed = (await admin.get(`/v1/users?managerId=${t.m.id}`)).json().items as {
      id: string;
      device: unknown;
    }[];
    expect(listed.find((user) => user.id === t.f1.id)?.device).toMatchObject({
      appVersion: '0.2.0',
    });
  });

  it('lists the territory tree for pickers', async () => {
    const t = await org('Tree Traders');
    const north = await world.territory(t.tenantId, 'NORTH');
    const delhi = await world.territory(t.tenantId, 'DELHI', north);
    const admin = await web(t.admin);
    expect((await admin.get('/v1/territories')).json().items).toEqual([
      { id: north, parentId: null, level: 1, code: 'NORTH', name: 'NORTH', active: true },
      { id: delhi, parentId: north, level: 2, code: 'DELHI', name: 'DELHI', active: true },
    ]);
  });
});

describe('transfers (M3)', () => {
  it('apply at once when dated today: manager and territories together', async () => {
    const t = await org('Today Transfers');
    const north = await world.territory(t.tenantId, 'NORTH');
    const south = await world.territory(t.tenantId, 'SOUTH');
    await world.attach(t.tenantId, t.f1.id, north, '2020-01-01');
    const admin = await web(t.admin);
    const moved = await admin.post(`/v1/users/${t.f1.id}/transfers`, {
      effectiveDate: today(),
      managerId: t.p.id,
      territoryIds: [south],
    });
    expect(moved.statusCode).toBe(201);
    expect(moved.json()).toMatchObject({ status: 'applied', effectiveDate: today() });
    const after = (await admin.get(`/v1/users/${t.f1.id}`)).json();
    expect(after.managerId).toBe(t.p.id);
    expect(after.territories.map((territory: { code: string }) => territory.code)).toEqual([
      'SOUTH',
    ]);
  });

  it('wait for their day, then apply once', async () => {
    const t = await org('Later Logistics');
    const admin = await web(t.admin);
    const later = inDays(10);
    const scheduled = await admin.post(`/v1/users/${t.f1.id}/transfers`, {
      effectiveDate: later,
      managerId: t.p.id,
      designation: 'manager',
    });
    expect(scheduled.json()).toMatchObject({ status: 'scheduled' });
    expect((await admin.get(`/v1/users/${t.f1.id}`)).json().managerId).toBe(t.m.id);

    const transfers = app.get(TransfersService);
    await transfers.applyDue(t.tenantId, inDays(9));
    expect((await admin.get(`/v1/users/${t.f1.id}`)).json().managerId).toBe(t.m.id);
    await transfers.applyDue(t.tenantId, later);
    await transfers.applyDue(t.tenantId, later);

    expect((await admin.get(`/v1/users/${t.f1.id}`)).json()).toMatchObject({
      managerId: t.p.id,
      designation: 'manager',
    });
    const items = (await admin.get(`/v1/users/${t.f1.id}/transfers`)).json().items;
    expect(items).toEqual([expect.objectContaining({ status: 'applied' })]);
  });

  it('refuse a past day, check the move now, and cancel only what is still to come', async () => {
    const t = await org('Careful Carriers');
    const admin = await web(t.admin);
    const past = await admin.post(`/v1/users/${t.f1.id}/transfers`, {
      effectiveDate: inDays(-1),
      managerId: t.p.id,
    });
    expect(error(past)?.details).toEqual([
      { path: 'effectiveDate', issue: 'Choose today or a later day' },
    ]);
    const loop = await admin.post(`/v1/users/${t.m.id}/transfers`, {
      effectiveDate: inDays(5),
      managerId: t.f1.id,
    });
    expect(error(loop)?.code).toBe('VALIDATION');

    const planned = await admin.post(`/v1/users/${t.f1.id}/transfers`, {
      effectiveDate: inDays(5),
      managerId: t.p.id,
    });
    const id = planned.json().id as string;
    const cancelled = await admin.post(`/v1/users/${t.f1.id}/transfers/${id}/cancel`);
    expect(cancelled.json()).toMatchObject({ status: 'cancelled' });
    const again = await admin.post(`/v1/users/${t.f1.id}/transfers/${id}/cancel`);
    expect(error(again)?.code).toBe('CONFLICT');
    await app.get(TransfersService).applyDue(t.tenantId, inDays(5));
    expect((await admin.get(`/v1/users/${t.f1.id}`)).json().managerId).toBe(t.m.id);
  });

  it('mark a transfer failed when its day comes and the rules refuse it', async () => {
    const t = await org('Failing Freight');
    const admin = await web(t.admin);
    const later = inDays(3);
    await admin.post(`/v1/users/${t.f1.id}/transfers`, { effectiveDate: later, managerId: t.p.id });
    // P can no longer have reports by then.
    await admin.patch(`/v1/users/${t.p.id}`, { designation: 'executive' });
    await app.get(TransfersService).applyDue(t.tenantId, later);

    const [failed] = (await admin.get(`/v1/users/${t.f1.id}/transfers`)).json().items;
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed.reason).toContain("managerId: This manager's designation cannot have reports");
    expect((await admin.get(`/v1/users/${t.f1.id}`)).json().managerId).toBe(t.m.id);
  });
});

describe('the organisation chart (M3)', () => {
  it('shows a level at a time with team counts, within the caller’s reach', async () => {
    const t = await org('Chart Chemicals');
    const admin = await web(t.admin);
    const top = (await admin.get('/v1/org-chart')).json();
    expect(top.items.map((node: { name: string }) => node.name)).toEqual([
      'Asha Admin',
      'Hari Head',
    ]);
    expect(top.items.find((node: { id: string }) => node.id === t.head.id)).toMatchObject({
      reports: 2,
      team: { manager: 2, executive: 2 },
    });
    expect(top.totals).toEqual({ head: 2, manager: 2, executive: 2 });

    const level = (await admin.get(`/v1/org-chart?managerId=${t.m.id}`)).json();
    expect(level.items.map((node: { name: string }) => node.name)).toEqual([
      'Farid Field',
      'Faye Field',
    ]);
    expect(level.totals).toEqual({ executive: 2 });

    const manager = await web(t.m);
    const mine = (await manager.get('/v1/org-chart')).json();
    expect(mine.items).toEqual([
      expect.objectContaining({ id: t.m.id, reports: 2, team: { executive: 2 } }),
    ]);
    const above = await manager.get(`/v1/org-chart?managerId=${t.head.id}`);
    expect(error(above)?.code).toBe('OUT_OF_SCOPE');
  });
});

describe("a person's history", () => {
  it('lists what changed about them, newest first, for those who reach them', async () => {
    const t = await org('History Hardware');
    const admin = await web(t.admin);
    await admin.patch(`/v1/users/${t.f1.id}`, { name: 'Farid Renamed' });
    await admin.post(`/v1/users/${t.f1.id}/transfers`, {
      effectiveDate: inDays(4),
      managerId: t.p.id,
    });
    const history = (await admin.get(`/v1/users/${t.f1.id}/history`)).json();
    expect(history.items.map((entry: { action: string }) => entry.action)).toEqual([
      'transfer.scheduled',
      'user.updated',
      'user.created',
    ]);
    const peer = await web(t.p);
    expect(error(await peer.get(`/v1/users/${t.f1.id}/history`))?.code).toBe('OUT_OF_SCOPE');
  });
});
