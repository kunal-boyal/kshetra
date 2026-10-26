import { newId, SETTING_DEFAULTS, todayIn, TENANT_PERMISSIONS } from '@thelamp/shared';
import { loadTemplate } from '@thelamp/templates';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newDevice, newPhone, type NewUser, startApp, World } from './support';

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

/** Designation keys in each template: someone who manages, and a field user. */
const ROLES_IN = {
  generic: { head: 'head', manager: 'manager', field: 'executive' },
  agri: { head: 'business_head', manager: 'asm', field: 'sme' },
} as const;

/** A tenant with an admin, a manager and a field user who reports to the manager. */
async function org(name: string, template: keyof typeof ROLES_IN = 'generic') {
  const tenantId = await world.tenant(name, 'active', template);
  const keys = ROLES_IN[template];
  const make = async (input: NewUser) => {
    const phone = newPhone();
    const user = await world.user(tenantId, { phone, ...input });
    return { id: user.id, phone };
  };
  const admin = await make({ designation: keys.head, role: 'tenant_admin' });
  const manager = await make({ designation: keys.manager });
  const field = await make({ designation: keys.field, managerId: manager.id });
  return { tenantId, admin, manager, field, make };
}

function as(token: string) {
  const send = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    url: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, ...headers },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string, headers?: Record<string, string>) => send('GET', url, undefined, headers),
    post: (url: string, payload: object) =>
      send('POST', url, payload, { 'idempotency-key': newId() }),
    patch: (url: string, payload: object) => send('PATCH', url, payload),
    put: (url: string, payload: object) => send('PUT', url, payload),
  };
}

const web = async (person: { phone: string }) => as((await world.signIn(person.phone)).accessToken);
const onPhone = async (person: { phone: string }) =>
  as((await world.signIn(person.phone, newDevice())).accessToken);
const code = (response: { json: () => unknown }) =>
  (response.json() as { error?: { code: string } }).error?.code;

describe('the config bundle (spec 11.2)', () => {
  it('carries settings, words, designations and access, with an ETag', async () => {
    const { admin } = await org('Amrit Agro');
    const owner = await web(admin);
    const response = await owner.get('/v1/config');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-cache');
    const bundle = response.json();
    expect(bundle.version).toBeGreaterThan(0);
    expect(bundle.settings).toEqual(SETTING_DEFAULTS);
    expect(bundle.terminology.en['term.account']).toEqual({ one: 'Account', other: 'Accounts' });
    expect(bundle.terminology.hi['term.punch_in']).toBe('दिन शुरू करें');
    expect(bundle.designations.map((d: { key: string }) => d.key)).toEqual([
      'head',
      'manager',
      'executive',
    ]);
    expect(bundle.access).toMatchObject({ role: 'tenant_admin', scope: 'tenant' });
    expect(bundle.access.permissions).toHaveLength(TENANT_PERMISSIONS.length);

    const etag = String(response.headers.etag);
    const unchanged = await owner.get('/v1/config', { 'if-none-match': etag });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe('');
    expect(unchanged.headers.etag).toBe(etag);
    expect((await owner.get('/v1/config', { 'if-none-match': `W/${etag}` })).statusCode).toBe(304);
  });

  it("speaks in the template's words, and shows each caller their own access", async () => {
    const { field } = await org('Bhoomi Seeds', 'agri');
    const bundle = (await (await onPhone(field)).get('/v1/config')).json();
    const words = loadTemplate('agri').terminology;
    expect(bundle.terminology.en['term.field_user']).toEqual(words['term.field_user']!.en);
    expect(bundle.terminology.hi['term.field_user']).toEqual(words['term.field_user']!.hi);
    // Terms the template leaves alone keep the product's word.
    expect(bundle.terminology.en['term.target']).toEqual({ one: 'Target', other: 'Targets' });
    expect(bundle.access).toMatchObject({ role: 'field_user', scope: 'self' });
  });
});

describe('changing configuration (module M2)', () => {
  it('reaches every app on its next fetch, with no release', async () => {
    const { admin, field } = await org('Charu Krishi');
    const owner = await web(admin);
    const phone = await onPhone(field);
    const before = await phone.get('/v1/config');
    const etag = String(before.headers.etag);

    const words = {
      'term.account': {
        en: { one: 'Party', other: 'Parties' },
        hi: { one: 'पार्टी', other: 'पार्टियाँ' },
      },
    };
    const replaced = await owner.put('/v1/terminology', words);
    expect(replaced.json()).toEqual({ overrides: words });
    expect((await owner.get('/v1/terminology')).json()).toEqual({ overrides: words });

    const after = await phone.get('/v1/config', { 'if-none-match': etag });
    expect(after.statusCode).toBe(200);
    expect(after.json().version).toBeGreaterThan(before.json().version);
    expect(after.json().terminology.en['term.account']).toEqual(words['term.account'].en);

    const changed = await owner.patch('/v1/settings', { gpsIntervalSeconds: 120 });
    expect(changed.json()).toEqual({ ...SETTING_DEFAULTS, gpsIntervalSeconds: 120 });
    const latest = (await phone.get('/v1/config')).json();
    expect(latest.version).toBeGreaterThan(after.json().version);
    expect(latest.settings.gpsIntervalSeconds).toBe(120);
    // Only what was sent changed.
    expect(latest.settings.deviceBinding).toBe(true);

    // An empty set of words brings back the product's.
    await owner.put('/v1/terminology', {});
    expect((await phone.get('/v1/config')).json().terminology.en['term.account']).toEqual({
      one: 'Account',
      other: 'Accounts',
    });
  });

  it('is for those who hold the permission, and checks every value', async () => {
    const { admin, manager } = await org('Deepak Agri');
    const managing = await web(manager);
    expect(code(await managing.patch('/v1/settings', { gpsIntervalSeconds: 120 }))).toBe(
      'FORBIDDEN',
    );
    expect(code(await managing.get('/v1/terminology'))).toBe('FORBIDDEN');
    expect(code(await managing.put('/v1/terminology', {}))).toBe('FORBIDDEN');

    const owner = await web(admin);
    const offset = await owner.patch('/v1/settings', { timezone: '+05:30' });
    expect(offset.statusCode).toBe(400);
    expect(offset.json().error.details).toEqual([
      { path: 'timezone', issue: 'Use an IANA time zone, such as Asia/Kolkata' },
    ]);
    expect(code(await owner.patch('/v1/settings', {}))).toBe('VALIDATION');
    expect(code(await owner.patch('/v1/settings', { brandColour: '#ffee88' }))).toBe('VALIDATION');
  });

  it('moves the version on when roles or designations change', async () => {
    const { admin } = await org('Ekta Inputs');
    const owner = await web(admin);
    const version = async () => (await owner.get('/v1/config')).json().version as number;

    const start = await version();
    await owner.post('/v1/designations', {
      key: 'trainee',
      name: {
        en: { one: 'Trainee', other: 'Trainees' },
        hi: { one: 'प्रशिक्षु', other: 'प्रशिक्षु' },
      },
      level: 4,
      defaultRole: 'field_user',
      canHaveReports: false,
    });
    const afterDesignation = await version();
    expect(afterDesignation).toBeGreaterThan(start);

    const roles = (await owner.get('/v1/roles')).json().items as { id: string; key: string }[];
    const viewer = roles.find((role) => role.key === 'viewer')!;
    await owner.patch(`/v1/roles/${viewer.id}`, { permissions: ['report.view'] });
    expect(await version()).toBeGreaterThan(afterDesignation);
  });
});

describe('settings at work', () => {
  it('let a second phone in while device binding is off', async () => {
    const { admin, field } = await org('Gaurav Seeds');
    const owner = await web(admin);
    await owner.patch('/v1/settings', { deviceBinding: false });
    const first = newDevice('First phone');
    const second = newDevice('Second phone');
    const one = as((await world.signIn(field.phone, first)).accessToken);
    const two = as((await world.signIn(field.phone, second)).accessToken);
    expect((await one.get('/v1/me')).statusCode).toBe(200);
    expect((await two.get('/v1/me')).statusCode).toBe(200);

    // Back on, the phones already in use carry on, and a new one is refused.
    await owner.patch('/v1/settings', { deviceBinding: true });
    expect((await world.verify(field.phone, first)).statusCode).toBe(200);
    expect(code(await world.verify(field.phone, newDevice('Third phone')))).toBe(
      'DEVICE_NOT_BOUND',
    );
  });

  it("read a number without a country code in the tenant's default country", async () => {
    const { admin } = await org('Himal Agro');
    const owner = await web(admin);
    await owner.patch('/v1/settings', { defaultCountry: 'NP' });
    const created = await owner.post('/v1/users', {
      code: 'NP-1',
      name: 'Kiran Karki',
      phone: '9841234567',
      designation: 'head',
    });
    expect(created.json().phone).toBe('+9779841234567');
  });

  it("decide which territory attachments apply today by the tenant's timezone", async () => {
    const { tenantId, admin, make } = await org('Ishaan Krishi');
    const owner = await web(admin);
    await owner.post('/v1/roles', {
      key: 'area_viewer',
      name: { en: 'Area viewer', hi: 'क्षेत्र दर्शक' },
      scope: 'territory',
      permissions: ['user.view'],
    });
    const region = await world.territory(tenantId, 'R1');
    const watcher = await make({ name: 'Vani Viewer', role: 'area_viewer' });
    const newcomer = await make({ name: 'Nikhil New' });
    await world.attach(tenantId, watcher.id, region);
    // Kiritimati is a day or more ahead of Pago Pago at every moment.
    await world.attach(tenantId, newcomer.id, region, todayIn('Pacific/Kiritimati'));

    const reached = async () =>
      ((await (await web(watcher)).get('/v1/users')).json().items as { id: string }[]).map(
        (user) => user.id,
      );
    await owner.patch('/v1/settings', { timezone: 'Pacific/Pago_Pago' });
    expect(await reached()).not.toContain(newcomer.id);
    await owner.patch('/v1/settings', { timezone: 'Pacific/Kiritimati' });
    expect(await reached()).toContain(newcomer.id);
  });
});
