import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAddress, newDevice, newPhone, startApp, testConfig, World } from './support';

/** Search across the product (phase 4 step A1, decision D110). */

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

const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, body?: object) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });

const search = async (token: string, q: string) =>
  (await call('GET', `/v1/search?q=${encodeURIComponent(q)}`, token)).json();

/**
 * An admin; a manager with Asha Verma under them; Ravi Kumar under the admin, outside the
 * manager's reach; a shop each for Asha and Ravi.
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
    name: 'Asha Verma',
    designation: 'executive',
    managerId: manager.id,
  });
  const ravi = await world.user(tenantId, {
    phone: phones.ravi,
    name: 'Ravi Kumar',
    designation: 'executive',
    managerId: admin.id,
  });
  const tokens = {
    admin: (await world.signIn(phones.admin)).accessToken,
    manager: (await world.signIn(phones.manager)).accessToken,
    asha: (await world.signIn(phones.asha, newDevice())).accessToken,
  };
  const territoryId = await world.territory(tenantId, `T-${newId().slice(-6)}`);
  const shop = async (shopName: string, holder: string) => {
    const made = await call('POST', '/v1/accounts', tokens.admin, {
      id: newId(),
      type: 'customer',
      code: `C-${newId().slice(-8)}`,
      name: shopName,
      territoryId,
      slots: { executive: holder },
    });
    expect(made.statusCode, made.body).toBe(201);
    return made.json().id as string;
  };
  const sharma = await shop('Sharma Stores', asha.id);
  const gupta = await shop('Gupta Traders', ravi.id);
  return { tenantId, phones, admin, manager, asha, ravi, tokens, sharma, gupta };
}

describe('search (D110)', () => {
  it('finds people and accounts within the caller’s scope, never beyond it', async () => {
    const t = await tenant('Search Co');
    const mine = await search(t.tokens.manager, 'Asha');
    expect(mine.people).toEqual([
      {
        id: t.asha.id,
        code: t.asha.code,
        name: 'Asha Verma',
        designation: 'executive',
        status: 'active',
      },
    ]);
    // Ravi reports to the admin, so the manager never finds him, by name or by number.
    expect((await search(t.tokens.manager, 'Ravi Kumar')).people).toEqual([]);
    expect((await search(t.tokens.manager, t.phones.ravi.slice(-10))).people).toEqual([]);
    expect((await search(t.tokens.manager, 'Sharma')).accounts).toEqual([
      expect.objectContaining({ id: t.sharma, name: 'Sharma Stores', type: 'customer' }),
    ]);
    expect((await search(t.tokens.manager, 'Gupta')).accounts).toEqual([]);
    // The admin sees everyone; a mobile number finds a person but never comes back.
    const byNumber = await search(t.tokens.admin, t.phones.ravi.slice(-10));
    expect(byNumber.people).toEqual([expect.objectContaining({ id: t.ravi.id })]);
    expect(JSON.stringify(byNumber)).not.toContain(t.phones.ravi.slice(-10));
  });

  it('leaves out what the caller may not list, rather than showing it empty', async () => {
    const t = await tenant('Field Search Co');
    // A field person sees accounts and orders, but not people or the form builder.
    const field = await search(t.tokens.asha, 'Sharma');
    expect(field).toMatchObject({ people: null, forms: null, orders: [] });
    expect(field.accounts).toEqual([expect.objectContaining({ id: t.sharma })]);
    expect((await search(t.tokens.asha, 'Gupta')).accounts).toEqual([]);
  });

  it('finds forms by their name in either language, and no orders while they are off', async () => {
    const t = await tenant('Form Search Co');
    expect((await search(t.tokens.admin, 'ग्राहक')).forms).toEqual([
      {
        id: expect.any(String),
        key: 'customer_visit',
        name: expect.objectContaining({ en: expect.anything() }),
      },
    ]);
    expect((await search(t.tokens.admin, 'meeting')).forms).toEqual([
      expect.objectContaining({ key: 'meeting' }),
    ]);
    expect(
      (await call('PATCH', '/v1/settings', t.tokens.admin, { modulesOff: ['orders'] })).statusCode,
    ).toBe(200);
    expect((await search(t.tokens.admin, '1001')).orders).toBeNull();
  });

  it('asks for two characters at least, and refuses API clients', async () => {
    const t = await tenant('Client Search Co');
    expect((await call('GET', '/v1/search?q=a', t.tokens.admin)).statusCode).toBe(400);
    const made = (
      await call('POST', '/v1/api-clients', t.tokens.admin, {
        id: newId(),
        name: 'ERP',
        scopes: ['people:write'],
      })
    ).json();
    const issued = await app.inject({
      method: 'POST',
      url: '/auth/v1/oauth/token',
      remoteAddress: newAddress(),
      payload: {
        grant_type: 'client_credentials',
        client_id: made.client.clientId,
        client_secret: made.clientSecret,
      },
    });
    const client = issued.json().access_token as string;
    expect((await call('GET', '/v1/search?q=Asha', client)).statusCode).toBe(403);
  });
});
