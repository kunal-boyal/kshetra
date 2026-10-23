import { newId } from '@thelamp/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { outboxEvents } from '../src/db/schema';
import { ImportsService } from '../src/modules/imports/imports.service';
import { Database } from '../src/platform/database';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Targets and account plans (spec 5.8, M8, BR-08, Appendix B.4 and B.6). */

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

const MONTH = '2030-01';
const NEXT = '2030-02';

function as(token: string) {
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object) => call('POST', url, payload),
    put: (url: string, payload: object) => call('PUT', url, payload),
    patch: (url: string, payload: object) => call('PATCH', url, payload),
    upload: (target: string, body: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/imports?target=${target}&fileName=plan.csv`,
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': newId(),
          'content-type': 'text/csv',
        },
        payload: body,
      }),
  };
}

type Api = ReturnType<typeof as>;

/**
 * A tenant on the generic template: its admin, a manager with Asha reporting to them, Ravi
 * reporting to the admin, and a shop Asha looks after.
 */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { admin: newPhone(), manager: newPhone(), asha: newPhone(), ravi: newPhone() };
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
    designation: 'executive',
    managerId: manager.id,
  });
  const ravi = await world.user(tenantId, {
    phone: phones.ravi,
    designation: 'executive',
    managerId: admin.id,
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
    slots: { executive: asha.id },
  });
  expect(made.statusCode).toBe(201);
  const shopCode = made.json().code as string;
  return { tenantId, admin, manager, asha, ravi, api, shop, shopCode };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

const put = (api: Api, userId: string, values: object, version: number, period = MONTH) =>
  api.put('/v1/targets', { period, sets: [{ userId, values, version }] });

describe('targets (spec 5.8)', () => {
  it("drafts targets for the people in scope, never one's own, at the version seen", async () => {
    const t = await tenant('Target Co');
    const grid = (await t.api.manager.get(`/v1/targets?period=${MONTH}`)).json();
    expect(grid.metrics.map((metric: { key: string }) => metric.key)).toEqual([
      'active_days',
      'coverage',
      'customers_covered',
      'order_value',
      'visits',
    ]);
    expect(grid.sets).toEqual([
      expect.objectContaining({
        user: expect.objectContaining({ id: t.asha.id }),
        status: 'none',
        version: 0,
      }),
    ]);
    expect(grid.own).toMatchObject({ user: { id: t.manager.id }, status: 'none' });

    const drafted = await put(
      t.api.manager,
      t.asha.id,
      { visits: '40', order_value: '125000.50' },
      0,
    );
    expect(drafted.statusCode).toBe(200);
    expect(drafted.json().sets[0]).toMatchObject({
      status: 'draft',
      values: { visits: '40', order_value: '125000.5' },
      version: 1,
    });
    expect((await put(t.api.manager, t.asha.id, { visits: '45' }, 0)).json().error.code).toBe(
      'CONFLICT',
    );
    const bad = await put(t.api.manager, t.asha.id, { visits: '40.5', speed: '1' }, 1);
    expect(bad.json().error.details).toEqual([
      { path: 'sets[0].values.visits', issue: 'Enter a whole number' },
      { path: 'sets[0].values.speed', issue: 'This metric has no targets' },
    ]);
    expect((await put(t.api.manager, t.manager.id, { visits: '1' }, 0)).json().error.code).toBe(
      'FORBIDDEN',
    );
    expect((await put(t.api.manager, t.ravi.id, { visits: '1' }, 0)).json().error.code).toBe(
      'OUT_OF_SCOPE',
    );
    expect((await put(t.api.asha, t.asha.id, { visits: '1' }, 1)).json().error.code).toBe(
      'FORBIDDEN',
    );

    const changed = await put(t.api.manager, t.asha.id, { visits: '45', order_value: null }, 1);
    expect(changed.json().sets[0]).toMatchObject({ values: { visits: '45' }, version: 2 });
    const totals = (await t.api.admin.get(`/v1/targets?period=${MONTH}`)).json().totals;
    expect(totals).toEqual({ visits: '45' });
    // Asha sees her own targets only.
    const own = (await t.api.asha.get(`/v1/targets?period=${MONTH}`)).json();
    expect(own.sets).toEqual([]);
    expect(own.own).toMatchObject({ values: { visits: '45' }, status: 'draft' });
  });

  it('locks drafts once, the first lock winning, and unlocks only as the tenant allows', async () => {
    const t = await tenant('Lock Co');
    await put(t.api.manager, t.asha.id, { visits: '40' }, 0);
    const lock = (userIds: string[]) =>
      t.api.manager.post('/v1/targets/lock', { period: MONTH, userIds });
    expect((await lock([t.asha.id, t.manager.id, t.ravi.id])).json()).toEqual({
      locked: [t.asha.id],
      skipped: [
        { userId: t.manager.id, reason: 'OWN' },
        { userId: t.ravi.id, reason: 'OUT_OF_SCOPE' },
      ],
    });
    expect((await lock([t.asha.id])).json().skipped).toEqual([
      { userId: t.asha.id, reason: 'TARGET_LOCKED' },
    ]);
    expect((await put(t.api.manager, t.asha.id, { visits: '50' }, 2)).json().error.code).toBe(
      'TARGET_LOCKED',
    );
    const grid = (await t.api.manager.get(`/v1/targets?period=${MONTH}`)).json();
    expect(grid.sets[0]).toMatchObject({
      status: 'locked',
      lockedBy: { id: t.manager.id },
      lockedAt: expect.any(String),
    });
    expect(
      (await t.api.manager.post('/v1/targets/lock', { period: NEXT, userIds: [t.asha.id] })).json()
        .skipped,
    ).toEqual([{ userId: t.asha.id, reason: 'EMPTY' }]);

    const unlock = (reason: string) =>
      t.api.admin.post('/v1/targets/unlock', { userId: t.asha.id, period: MONTH, reason });
    expect(
      (
        await t.api.manager.post('/v1/targets/unlock', {
          userId: t.asha.id,
          period: MONTH,
          reason: 'Territory changed',
        })
      ).json().error.code,
    ).toBe('FORBIDDEN');
    expect((await unlock('Territory changed mid-month')).json().error.code).toBe('TARGET_LOCKED');
    await t.api.admin.patch('/v1/settings', { targetUnlockByAdmin: true });
    expect((await unlock('Too short')).json().error.details).toEqual([
      { path: 'reason', issue: 'Write at least 10 characters' },
    ]);
    const unlocked = await unlock('Territory changed mid-month');
    expect(unlocked.json()).toMatchObject({ status: 'draft', lockedAt: null, version: 3 });
    // Scores follow locks and unlocks (spec 12.3).
    const published = await app.get(Database).forTenant(t.tenantId, (tx) =>
      tx
        .select({ type: outboxEvents.type, payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.tenantId, t.tenantId),
            inArray(outboxEvents.type, ['target.locked', 'target.unlocked']),
          ),
        )
        .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id)),
    );
    expect(published).toEqual([
      {
        type: 'target.locked',
        payload: expect.objectContaining({ userId: t.asha.id, period: MONTH }),
      },
      {
        type: 'target.unlocked',
        payload: expect.objectContaining({ userId: t.asha.id, period: MONTH }),
      },
    ]);
  });

  it("copies an earlier month's targets into drafts, leaving locked ones alone", async () => {
    const t = await tenant('Copy Co');
    await put(t.api.manager, t.asha.id, { visits: '40', coverage: '80' }, 0);
    const copied = await t.api.manager.post('/v1/targets/copy', {
      period: NEXT,
      from: MONTH,
      userIds: [t.asha.id],
    });
    expect(copied.json()).toEqual({ copied: [t.asha.id], skipped: [] });
    const next = (await t.api.manager.get(`/v1/targets?period=${NEXT}`)).json().sets[0];
    expect(next).toMatchObject({ status: 'draft', values: { visits: '40', coverage: '80' } });
    await t.api.manager.post('/v1/targets/lock', { period: NEXT, userIds: [t.asha.id] });
    expect(
      (
        await t.api.manager.post('/v1/targets/copy', {
          period: NEXT,
          from: MONTH,
          userIds: [t.asha.id],
        })
      ).json().skipped,
    ).toEqual([{ userId: t.asha.id, reason: 'TARGET_LOCKED' }]);
  });
});

describe('account plans (M8)', () => {
  it('lets managers plan an account’s month, and everyone who sees the account read it', async () => {
    const t = await tenant('Plan Co');
    const set = await t.api.manager.put('/v1/account-plans', {
      accountId: t.shop,
      period: MONTH,
      values: { order_value: '500000', visits: '4' },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({
      values: { order_value: '500000', visits: '4' },
      updatedBy: { id: t.manager.id },
    });
    const seen = (
      await t.api.asha.get(`/v1/account-plans?accountId=${t.shop}&period=${MONTH}`)
    ).json();
    expect(seen.values).toEqual({ order_value: '500000', visits: '4' });
    expect(
      (await t.api.ravi.get(`/v1/account-plans?accountId=${t.shop}&period=${MONTH}`)).json().error
        .code,
    ).toBe('OUT_OF_SCOPE');
    expect(
      (
        await t.api.asha.put('/v1/account-plans', {
          accountId: t.shop,
          period: MONTH,
          values: { visits: '5' },
        })
      ).json().error.code,
    ).toBe('FORBIDDEN');
  });
});

describe('importing targets and account plans (Appendix B.4, B.6)', () => {
  const csv = (rows: (string | number)[][]) =>
    rows.map((row) => row.map((cell) => `"${String(cell)}"`).join(',')).join('\n');

  async function importFile(t: Tenant, target: string, body: string) {
    const uploaded = await t.api.admin.upload(target, body);
    expect(uploaded.statusCode).toBe(201);
    const id = uploaded.json().id as string;
    const imports = app.get(ImportsService);
    await imports.read(t.tenantId, id);
    const read = (await t.api.admin.get(`/v1/imports/${id}`)).json();
    expect(
      (await t.api.admin.put(`/v1/imports/${id}/mapping`, { mapping: read.mapping })).statusCode,
    ).toBe(200);
    await imports.check(t.tenantId, id);
    const checked = (await t.api.admin.get(`/v1/imports/${id}`)).json();
    if (checked.status !== 'ready') return checked;
    await t.api.admin.post(`/v1/imports/${id}/commit`);
    await imports.write(t.tenantId, id);
    return (await t.api.admin.get(`/v1/imports/${id}`)).json();
  }

  it('imports targets with a lock, and refuses rows it can’t take', async () => {
    const t = await tenant('Import Co');
    const refused = await importFile(
      t,
      'targets',
      csv([
        ['Employee code', 'Period', 'Visit', 'Order value', 'Lock'],
        [t.asha.code, MONTH, '40.5', '', ''],
        ['NOBODY', MONTH, '10', '', ''],
        [t.admin.code, MONTH, '10', '', ''],
      ]),
    );
    expect(refused.status).toBe('invalid');
    expect(refused.errors).toEqual([
      { row: 2, field: 'metric.visits', issue: 'Enter a whole number' },
      { row: 3, field: 'code', issue: 'No one has this employee code' },
      { row: 4, field: 'code', issue: 'Your own targets are set by your manager' },
    ]);

    const done = await importFile(
      t,
      'targets',
      csv([
        ['Employee code', 'Period', 'Visit', 'Order value', 'Lock'],
        [t.asha.code, MONTH, '40', '125000.50', 'Yes'],
        [t.ravi.code, MONTH, '30', '', ''],
      ]),
    );
    expect(done.status).toBe('committed');
    const grid = (await t.api.admin.get(`/v1/targets?period=${MONTH}`)).json();
    const byId = new Map(grid.sets.map((set: { user: { id: string } }) => [set.user.id, set]));
    expect(byId.get(t.asha.id)).toMatchObject({
      status: 'locked',
      values: { visits: '40', order_value: '125000.5' },
    });
    expect(byId.get(t.ravi.id)).toMatchObject({ status: 'draft', values: { visits: '30' } });

    // A locked set takes no import while admin unlock is off.
    const locked = await importFile(
      t,
      'targets',
      csv([
        ['Employee code', 'Period', 'Visit'],
        [t.asha.code, MONTH, '50'],
      ]),
    );
    expect(locked.errors).toEqual([{ row: 2, field: null, issue: 'These targets are locked' }]);
  });

  it('imports account plans for accounts the importer sees', async () => {
    const t = await tenant('Plan Import Co');
    const done = await importFile(
      t,
      'account_plans',
      csv([
        ['Account code', 'Period', 'Order value', 'Visit'],
        [t.shopCode, MONTH, '500000', '4'],
      ]),
    );
    expect(done.status).toBe('committed');
    const plan = (
      await t.api.admin.get(`/v1/account-plans?accountId=${t.shop}&period=${MONTH}`)
    ).json();
    expect(plan.values).toEqual({ order_value: '500000', visits: '4' });
  });
});
