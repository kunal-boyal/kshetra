import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { billableSeats, newId, todayIn } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StaffService } from '../src/modules/console/staff.service';
import { totpAt, totpStep } from '../src/platform/totp';
import { MeteringService } from '../src/modules/metering/metering.service';
import { newPhone, settledStep, startApp, testConfig, World } from './support';

/**
 * Plans, entitlements, seats and usage (modules M22 and M23, BR-45, decision D89): plans in the
 * console, the modules a plan leaves out closing for its tenants, the cap on active people, and
 * each month's metered usage.
 */

let app: NestFastifyApplication;
let world: World;
let staff: string;

beforeAll(async () => {
  app = await startApp(testConfig());
  world = await World.create(app);
  staff = await staffToken();
});

afterAll(async () => {
  await world.end();
  await app.close();
});

const address = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

function send(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

/** A platform admin, invited, set up and signed in. */
async function staffToken(): Promise<string> {
  const email = `billing-${newId().slice(-8)}@vendor.example`;
  const { setupUrl } = await app
    .get(StaffService)
    .invite({ id: newId(), email, name: 'Billing Admin', role: 'platform_admin' }, null);
  const token = setupUrl.split('#')[1]!;
  const setUp = await app.inject({
    method: 'POST',
    url: '/platform/v1/setup',
    remoteAddress: address(),
    payload: { token, password: 'a long staff password' },
  });
  const { secret } = setUp.json();
  await app.inject({
    method: 'POST',
    url: '/platform/v1/setup/confirm',
    remoteAddress: address(),
    payload: { token, code: totpAt(secret, (await settledStep()) - 1) },
  });
  const signedIn = await app.inject({
    method: 'POST',
    url: '/platform/v1/session',
    remoteAddress: address(),
    payload: { email, password: 'a long staff password', code: totpAt(secret, totpStep()) },
  });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  return signedIn.json().accessToken;
}

const plan = (key: string, extra: object = {}) => ({
  key,
  name: { en: `${key} plan`, hi: `${key} plan` },
  priceMonth: '150',
  priceYear: '1500',
  modules: ['core', 'leave_attendance'],
  limits: { users: null, storageGb: null },
  addons: [],
  active: true,
  ...extra,
});

async function addPlan(key: string, extra: object = {}): Promise<string> {
  const id = newId();
  const made = await send('POST', '/platform/v1/plans', staff, { id, ...plan(key, extra) });
  expect(made.statusCode, made.body).toBe(201);
  return id;
}

/** A tenant with its admin signed in on the web. */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  return { tenantId, admin: (await world.signIn(phone)).accessToken };
}

describe('plans in the console (M23)', () => {
  it('adds a plan once, keeps its key, and counts its tenants', async () => {
    const key = `p${newId().slice(-8)}`;
    const id = newId();
    const body = {
      id,
      ...plan(key, { addons: [{ key: 'sms_pack', name: { en: 'SMS', hi: 'SMS' }, price: '250' }] }),
    };
    expect((await send('POST', '/platform/v1/plans', staff, body)).statusCode).toBe(201);
    // The same create again answers with the same plan; another key under its ID is refused.
    expect((await send('POST', '/platform/v1/plans', staff, body)).json().id).toBe(id);
    expect(
      (await send('POST', '/platform/v1/plans', staff, { ...body, key: `${key}x` })).json().error
        .code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    const taken = await send('POST', '/platform/v1/plans', staff, { ...body, id: newId() });
    expect(taken.json().error.details).toEqual([
      { path: 'key', issue: 'Already used by another plan' },
    ]);
    expect(
      (
        await send('POST', '/platform/v1/plans', staff, {
          ...body,
          id: newId(),
          key: `${key}y`,
          modules: ['orders'],
        })
      ).json().error.details,
    ).toEqual([{ path: 'modules', issue: 'Every plan includes core' }]);

    const changed = await send('PUT', `/platform/v1/plans/${id}`, staff, {
      ...plan(key),
      priceMonth: '175.50',
    });
    expect(changed.json()).toMatchObject({ priceMonth: '175.50', tenants: 0 });
    const rekeyed = await send('PUT', `/platform/v1/plans/${id}`, staff, plan(`${key}z`));
    expect(rekeyed.json().error.details).toEqual([{ path: 'key', issue: 'A plan keeps its key' }]);

    const t = await tenant('Counted Co');
    const onPlan = await send('PUT', `/platform/v1/tenants/${t.tenantId}/plan`, staff, {
      planId: id,
    });
    expect(onPlan.statusCode, onPlan.body).toBe(200);
    const listed = (await send('GET', '/platform/v1/plans', staff)).json().items;
    expect(listed.find((each: { id: string }) => each.id === id)).toMatchObject({ tenants: 1 });
    const console = (await send('GET', `/platform/v1/tenants/${t.tenantId}`, staff)).json();
    expect(console.plan).toMatchObject({ id, key });
  });
});

describe('entitlements (spec 5.13)', () => {
  it('closes the modules a plan leaves out, which the tenant cannot switch on', async () => {
    const t = await tenant('Entitled Co');
    // Without a plan, every module is open.
    expect((await send('GET', '/v1/orders', t.admin)).statusCode).toBe(200);

    const basic = await addPlan(`basic${newId().slice(-6)}`);
    const set = await send('PUT', `/platform/v1/tenants/${t.tenantId}/plan`, staff, {
      planId: basic,
    });
    expect(set.json()).toMatchObject({
      modules: ['core', 'leave_attendance'],
      extraModules: [],
      limits: { users: null, storageGb: null },
      ownLimits: {},
    });
    expect((await send('GET', '/v1/orders', t.admin)).json().error.code).toBe('MODULE_DISABLED');
    const bundle = (await send('GET', '/v1/config', t.admin)).json();
    expect(bundle.settings.modulesOff).toEqual(
      expect.arrayContaining(['orders', 'account_finance', 'expenses']),
    );
    expect(bundle.settings.modulesOff).not.toContain('leave_attendance');

    // The admin can switch off what the plan opens, never on what it leaves out.
    const opened = await send('PATCH', '/v1/settings', t.admin, { modulesOff: [] });
    expect(opened.json().error.details).toEqual([
      expect.objectContaining({
        path: 'modulesOff',
        issue: expect.stringMatching(/^Your plan does not include /),
      }),
    ]);
    const closed = await send('PATCH', '/v1/settings', t.admin, {
      modulesOff: [
        'orders',
        'account_finance',
        'expenses',
        'payroll_inputs',
        'integrations',
        'sso',
        'advanced_analytics',
        'leave_attendance',
      ],
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().modulesOff).toContain('leave_attendance');

    // A module added for this tenant alone opens; moving off the plan opens everything again,
    // except what the admin chose to switch off.
    await send('PUT', `/platform/v1/tenants/${t.tenantId}/plan`, staff, {
      planId: basic,
      extraModules: ['orders'],
    });
    expect((await send('GET', '/v1/orders', t.admin)).statusCode).toBe(200);
    await send('PUT', `/platform/v1/tenants/${t.tenantId}/plan`, staff, { planId: null });
    const free = (await send('GET', '/v1/config', t.admin)).json().settings.modulesOff;
    expect(free).toEqual(['leave_attendance']);
  });

  it('caps active people at the plan’s limit (SEAT_LIMIT)', async () => {
    const t = await tenant('Capped Co');
    const capped = await addPlan(`cap${newId().slice(-6)}`, {
      modules: ['core', 'leave_attendance', 'orders', 'account_finance', 'expenses'],
      limits: { users: 2, storageGb: null },
    });
    await send('PUT', `/platform/v1/tenants/${t.tenantId}/plan`, staff, { planId: capped });
    const add = (code: string) =>
      send('POST', '/v1/users', t.admin, {
        code,
        name: `Person ${code}`,
        phone: newPhone(),
        designation: 'executive',
        managerId: null,
      });
    const second = await add('P2');
    expect(second.statusCode, second.body).toBe(201);
    const third = await add('P3');
    expect(third.statusCode).toBe(402);
    expect(third.json().error.code).toBe('SEAT_LIMIT');

    // Deactivating someone frees a seat, and reactivating takes one again.
    const secondId = second.json().id;
    const version = second.json().version;
    const off = await send('PATCH', `/v1/users/${secondId}`, t.admin, {
      status: 'inactive',
      version,
    });
    expect(off.statusCode, off.body).toBe(200);
    expect((await add('P4')).statusCode).toBe(201);
    const back = await send('PATCH', `/v1/users/${secondId}`, t.admin, {
      status: 'active',
      version: off.json().version,
    });
    expect(back.json().error.code).toBe('SEAT_LIMIT');

    // A cap of the tenant's own replaces the plan's; one lifted for it alone is null.
    const own = await send('PUT', `/platform/v1/tenants/${t.tenantId}/plan`, staff, {
      planId: capped,
      limits: { users: 3, storageGb: null },
    });
    expect(own.json()).toMatchObject({
      limits: { users: 3, storageGb: null },
      ownLimits: { users: 3, storageGb: null },
    });
    expect(
      (
        await send('PATCH', `/v1/users/${secondId}`, t.admin, {
          status: 'active',
          version: off.json().version,
        })
      ).statusCode,
    ).toBe(200);
  });
});

describe('metered usage (M22, BR-45)', () => {
  it('measures seats, sign-ins and API calls for the month, as the console shows them', async () => {
    const t = await tenant('Metered Co');
    const second = await world.user(t.tenantId, { phone: newPhone(), designation: 'executive' });
    for (let call = 0; call < 3; call++) await send('GET', '/v1/me', t.admin);

    await app.get(MeteringService).meter(t.tenantId);
    const usage = await send('GET', `/platform/v1/tenants/${t.tenantId}/usage`, staff);
    expect(usage.statusCode, usage.body).toBe(200);
    const period = todayIn('Asia/Kolkata').slice(0, 7);
    const month = usage.json().items.find((item: { period: string }) => item.period === period);
    // Both people started today: each is billed from today to the month's end (BR-45).
    const today = todayIn('Asia/Kolkata');
    const expected = billableSeats(
      [
        { userId: 'admin', from: today, to: null },
        { userId: 'second', from: today, to: null },
      ],
      `${period}-01`,
      new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0))
        .toISOString()
        .slice(0, 10),
    );
    expect(month.metrics).toMatchObject({
      seats: expected.units,
      active_users: '1.0000',
      storage_bytes: '0.0000',
      sms: '0.0000',
      whatsapp: '0.0000',
    });
    expect(Number(month.metrics.api_calls)).toBeGreaterThanOrEqual(3);
    void second;
  });
});
