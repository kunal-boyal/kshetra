import { newId, routeDates, todayIn } from '@kshetra/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlanningService } from '../src/modules/planning/planning.service';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Journey plans (M8, BR-34, BR-35): routes, months of plan items, visits and approval. */

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

const H = 3_600_000;
const HERE = { lat: 28.6315, lng: 77.2167 };
const TODAY = () => todayIn('Asia/Kolkata');

/** The month after this one, `YYYY-MM`. */
function nextMonth(): string {
  const [year, month] = TODAY().split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

function as(token: string) {
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object) => call('POST', url, payload),
    patch: (url: string, payload: object) => call('PATCH', url, payload),
  };
}

/**
 * A tenant with its admin, a manager with Asha reporting to them, and Ravi reporting to the
 * admin; a shop Asha looks after and one Ravi does.
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
  const territoryId = await world.territory(tenantId, `T-${newId().slice(-6)}`);
  const shop = async (holder: string, shopName: string) => {
    const id = newId();
    const made = await api.admin.post('/v1/accounts', {
      id,
      type: 'customer',
      code: `C-${newId().slice(-8)}`,
      name: shopName,
      territoryId,
      location: HERE,
      slots: { executive: holder },
    });
    expect(made.statusCode).toBe(201);
    return id;
  };
  return {
    tenantId,
    manager,
    asha,
    ravi,
    api,
    shop: await shop(asha.id, 'Sharma Stores'),
    corner: await shop(asha.id, 'Corner Kirana'),
    ravisShop: await shop(ravi.id, 'Verma Traders'),
  };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

const route = (t: Tenant, accountIds: string[], days = [1, 4]) => ({
  id: newId(),
  userId: t.asha.id,
  name: 'Market road',
  recurrence: { kind: 'weekdays', days },
  accountIds,
});

const adhoc = (t: Tenant, overrides: object = {}) => ({
  id: newId(),
  userId: t.asha.id,
  accountId: t.shop,
  date: TODAY(),
  purpose: 'Collect payment',
  ...overrides,
});

describe('routes and months of plan items (M8)', () => {
  it('plans a month from routes, once however often it runs, only at places the person sees', async () => {
    const t = await tenant('Route Co');
    const refused = await t.api.manager.post('/v1/routes', route(t, [t.shop, t.ravisShop]));
    expect(refused.json().error.details).toEqual([
      { path: 'accountIds[1]', issue: 'Choose a place this person looks after' },
    ]);
    const body = route(t, [t.shop, t.corner]);
    const made = await t.api.manager.post('/v1/routes', body);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      userId: t.asha.id,
      name: 'Market road',
      accounts: [{ id: t.shop }, { id: t.corner }],
      active: true,
    });
    expect((await t.api.asha.post('/v1/routes', route(t, [t.shop]))).json().error.code).toBe(
      'FORBIDDEN',
    );

    const period = nextMonth();
    const dates = routeDates({ kind: 'weekdays', days: [1, 4] }, period);
    const first = await t.api.manager.post('/v1/plans/generate', { userId: t.asha.id, period });
    expect(first.json()).toEqual({ created: dates.length * 2, skippedAccounts: [] });
    const again = await t.api.manager.post('/v1/plans/generate', { userId: t.asha.id, period });
    expect(again.json()).toEqual({ created: 0, skippedAccounts: [] });

    const plan = (
      await t.api.asha.get(`/v1/plan-items?userId=${t.asha.id}&period=${period}`)
    ).json();
    expect(plan.items).toHaveLength(dates.length * 2);
    expect(plan.items[0]).toMatchObject({
      date: dates[0],
      account: { id: t.shop, name: 'Sharma Stores' },
      status: 'planned',
      source: 'route',
      routeId: body.id,
    });
    expect(plan.approval).toBeNull();

    // Off the route, Corner Kirana is planned no more; switched off, the route plans nothing.
    const changed = await t.api.manager.patch(`/v1/routes/${body.id}`, {
      accountIds: [t.shop],
      name: 'Main road',
    });
    expect(changed.json()).toMatchObject({ name: 'Main road', accounts: [{ id: t.shop }] });
    await t.api.manager.patch(`/v1/routes/${body.id}`, { active: false });
    expect(
      (await t.api.manager.post('/v1/plans/generate', { userId: t.asha.id, period })).json()
        .created,
    ).toBe(0);
    expect(
      (await t.api.manager.post('/v1/plans/generate', { userId: t.ravi.id, period })).json().error
        .code,
    ).toBe('OUT_OF_SCOPE');
  });

  it('plans visits by hand: managers for their people, and people for themselves', async () => {
    const t = await tenant('Adhoc Co');
    const own = await t.api.asha.post('/v1/plan-items', adhoc(t));
    expect(own.statusCode).toBe(201);
    expect(own.json()).toMatchObject({
      status: 'planned',
      source: 'adhoc',
      purpose: 'Collect payment',
    });
    expect(
      (await t.api.asha.post('/v1/plan-items', adhoc(t, { userId: t.ravi.id }))).json().error.code,
    ).toBe('FORBIDDEN');
    expect(
      (await t.api.asha.post('/v1/plan-items', adhoc(t, { date: '2020-01-01' }))).json().error
        .details,
    ).toEqual([{ path: 'date', issue: 'Choose today or a later day' }]);
    expect(
      (await t.api.manager.post('/v1/plan-items', adhoc(t, { accountId: t.ravisShop }))).json()
        .error.details,
    ).toEqual([{ path: 'accountId', issue: 'Choose a place this person looks after' }]);

    const planned = (await t.api.manager.post('/v1/plan-items', adhoc(t))).json();
    expect((await t.api.asha.post(`/v1/plan-items/${planned.id}/cancel`)).json().error.code).toBe(
      'FORBIDDEN',
    );
    const cancelled = await t.api.manager.post(`/v1/plan-items/${planned.id}/cancel`);
    expect(cancelled.json().status).toBe('cancelled');
    expect(
      (await t.api.manager.post(`/v1/plan-items/${planned.id}/cancel`)).json().error.code,
    ).toBe('CONFLICT');
  });
});

describe('plan items as they are visited and reviewed (BR-34, BR-35)', () => {
  it('moves to visited at check-in, completed on approval, and back on rejection', async () => {
    const t = await tenant('Status Co');
    const form = await t.api.admin.post('/v1/forms', {
      definition: {
        key: 'note',
        name: { en: { one: 'Note', other: 'Notes' }, hi: { one: 'नोट', other: 'नोट' } },
        icon: 'notebook-pen',
        accountLink: { mode: 'optional', accountTypes: ['customer'] },
        fields: [{ key: 'text', type: 'short_text', label: { en: 'Text', hi: 'Text' } }],
      },
    });
    expect(form.statusCode).toBe(201);
    await t.api.asha.post('/v1/shifts', {
      id: newId(),
      startedAt: new Date(Date.now() - H).toISOString(),
      location: HERE,
      accuracy: 15,
      mocked: false,
      consentVersion: '2026-10',
    });
    const item = (await t.api.manager.post('/v1/plan-items', adhoc(t))).json();
    const checkIn = (planItemId: string, accountId = t.shop) => ({
      id: newId(),
      accountId,
      checkedInAt: new Date().toISOString(),
      fix: { location: HERE, accuracy: 12, mocked: false, capturedAt: new Date().toISOString() },
      planItemId,
    });
    const elsewhere = await t.api.asha.post('/v1/visits', checkIn(item.id, t.corner));
    expect(elsewhere.json().error.details).toEqual([
      { path: 'planItemId', issue: 'This planned visit is to another place' },
    ]);
    const visit = checkIn(item.id);
    const visited = await t.api.asha.post('/v1/visits', visit);
    expect(visited.json()).toMatchObject({ planItemId: item.id });
    const status = async () =>
      (await t.api.asha.get(`/v1/plan-items?userId=${t.asha.id}&period=${TODAY().slice(0, 7)}`))
        .json()
        .items.find((entry: { id: string }) => entry.id === item.id);
    expect(await status()).toMatchObject({ status: 'visited', visitId: visit.id });

    const submission = newId();
    const sent = await t.api.asha.post('/v1/submissions', {
      id: submission,
      form: { key: 'note', version: 1 },
      visitId: visit.id,
      capturedAt: new Date().toISOString(),
      fix: { location: HERE, accuracy: 12, mocked: false, capturedAt: new Date().toISOString() },
      values: { text: 'Paid in full' },
    });
    expect(sent.statusCode).toBe(201);
    await t.api.manager.post(`/v1/submissions/${submission}/review`, { decision: 'approved' });
    expect((await status()).status).toBe('completed');
    await t.api.manager.post(`/v1/submissions/${submission}/review`, {
      decision: 'rejected',
      note: 'Not the right receipt',
    });
    expect((await status()).status).toBe('planned');

    // Someone else's plan item can't start a visit.
    const ravisItem = (
      await t.api.admin.post(
        '/v1/plan-items',
        adhoc(t, { userId: t.ravi.id, accountId: t.ravisShop }),
      )
    ).json();
    expect((await t.api.asha.post('/v1/visits', checkIn(ravisItem.id))).json().error.code).toBe(
      'OUT_OF_SCOPE',
    );
  });

  it('misses what is still planned once its day has ended', async () => {
    const t = await tenant('Missed Co');
    const item = (await t.api.manager.post('/v1/plan-items', adhoc(t))).json();
    const kept = (await t.api.manager.post('/v1/plan-items', adhoc(t))).json();
    await t.api.manager.post(`/v1/plan-items/${kept.id}/cancel`);
    const tomorrow = new Date(Date.now() + 36 * H).toISOString().slice(0, 10);
    const missed = await world.database.forTenant(t.tenantId, (tx) =>
      app.get(PlanningService).missDayEnded(tx, t.tenantId, tomorrow),
    );
    expect(missed).toBe(1);
    const items = (
      await t.api.asha.get(`/v1/plan-items?userId=${t.asha.id}&period=${TODAY().slice(0, 7)}`)
    ).json().items;
    expect(items.map((entry: { id: string; status: string }) => [entry.id, entry.status])).toEqual(
      expect.arrayContaining([
        [item.id, 'missed'],
        [kept.id, 'cancelled'],
      ]),
    );
  });
});

describe("a month's plan approved by the manager (M8, journey_plan)", () => {
  it('waits for approval once sent, and then stays as agreed but for the person’s own visits', async () => {
    const t = await tenant('Approval Co');
    const period = nextMonth();
    const date = `${period}-15`;
    await t.api.manager.post('/v1/plan-items', adhoc(t, { date }));
    expect(
      (await t.api.asha.post('/v1/plans/submit', { userId: t.asha.id, period })).json().error.code,
    ).toBe('CONFLICT');

    expect(
      (await t.api.admin.patch('/v1/settings', { journeyPlanApproval: true })).statusCode,
    ).toBe(200);
    const plan = () =>
      t.api.asha.get(`/v1/plan-items?userId=${t.asha.id}&period=${period}`).then((r) => r.json());
    expect((await plan()).approval).toEqual({ status: 'draft', approvalId: null });
    const sent = await t.api.asha.post('/v1/plans/submit', { userId: t.asha.id, period });
    expect(sent.json()).toMatchObject({ status: 'submitted', approvalId: expect.any(String) });
    expect((await t.api.manager.post('/v1/plan-items', adhoc(t, { date }))).json().error.code).toBe(
      'CONFLICT',
    );

    const [request] = (await t.api.manager.get('/v1/approvals/inbox')).json().items;
    expect(request).toMatchObject({
      requestType: 'journey_plan',
      subject: { title: expect.stringContaining(period), accountId: null },
    });
    const decided = await t.api.manager.post(`/v1/approvals/${request.id}/decision`, {
      decision: 'approve',
      version: request.version,
    });
    expect(decided.statusCode).toBe(200);
    expect((await plan()).approval.status).toBe('approved');

    expect(
      (await t.api.manager.post('/v1/plans/generate', { userId: t.asha.id, period })).json().error
        .code,
    ).toBe('CONFLICT');
    // The person's own visits still go in.
    expect((await t.api.asha.post('/v1/plan-items', adhoc(t, { date }))).statusCode).toBe(201);
  });
});
