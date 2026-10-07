import { type DeviceInfo, newId } from '@kshetra/shared';
import { ModulesContainer } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { apiControllers } from '../src/app.module';
import { routeRegistry } from '../src/platform/routes';
import { newDevice, newPhone, startApp, World } from './support';

/**
 * The cross-tenant contract test (spec 14.4), over every route in the registry. Someone signed in
 * to tenant B who uses tenant A's IDs gets the answer an ID that exists nowhere gets, never a
 * success; what B reads holds nothing of A's; and after each of B's requests, every row tenant A
 * owns, in every table that has a `tenant_id`, is exactly as it was. A route without a fixture
 * here fails the test, so a new route can't ship without its case.
 */

const routes = routeRegistry(apiControllers());

let app: NestFastifyApplication;
let world: World;

type Reply = Awaited<ReturnType<NestFastifyApplication['inject']>>;
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';

interface Person {
  id: string;
  phone: string;
}

interface Tenant {
  tenantId: string;
  admin: Person;
  member: Person;
  /** The phone the member is bound to. */
  memberDevice: DeviceInfo;
  roleId: string;
  designationId: string;
  /** The tenant's own word for `term.account`, which no other tenant uses. */
  word: string;
}

let a: Tenant;
let b: Tenant;
let bToken: string;
/** A cursor tenant A's admin was given by a sync pull. */
let aCursor: string;
/** Every ID in tenant A's rows that tenant B doesn't also hold. */
let aIds: string[];
let aRows: Record<string, unknown[]>;

async function admin<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: inject('databaseUrls').admin });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** Every row a tenant owns, in every table with a `tenant_id`, in the cell and the directory. */
async function rowsOf(tenantId: string): Promise<Record<string, unknown[]>> {
  const tables = await admin<{ schema: string; name: string }>(
    `select n.nspname as schema, c.relname as name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where n.nspname in ('cell', 'directory') and c.relkind in ('r', 'p') and not c.relispartition
      order by 1, 2`,
  );
  const rows: Record<string, unknown[]> = {};
  for (const { schema, name } of tables) {
    const [found] = await admin<{ rows: unknown[] }>(
      `select coalesce(json_agg(t order by t::text), '[]') as rows
         from "${schema}"."${name}" t where tenant_id = $1`,
      [tenantId],
    );
    rows[`${schema}.${name}`] = found!.rows;
  }
  return rows;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const idsIn = (value: unknown) => new Set(JSON.stringify(value).match(UUID) ?? []);

function send(token: string | undefined, method: Method, url: string, payload?: object) {
  return app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      // Every write takes one (BR-46); reads ignore it.
      'idempotency-key': newId(),
    },
    ...(payload ? { payload } : {}),
  });
}

const asB = (method: Method, url: string, payload?: object) => send(bToken, method, url, payload);

const errorOf = (reply: Reply) => {
  const { error } = reply.json() as { error?: { requestId?: string } };
  return error ? { ...error, requestId: undefined } : undefined;
};

/** B's answer for A's ID is the answer for an ID that exists nowhere: a refusal that says nothing. */
async function sameAsNowhere(call: (id: string) => Promise<Reply>, theirId: string) {
  const theirs = await call(theirId);
  const nowhere = await call(newId());
  expect([400, 403, 404]).toContain(theirs.statusCode);
  expect(theirs.statusCode).toBe(nowhere.statusCode);
  expect(errorOf(theirs)).toEqual(errorOf(nowhere));
}

/** What B reads holds no ID of A's, and none of A's own words. */
function holdsNothingOfA(reply: Reply) {
  for (const id of aIds) expect(reply.body, `B's answer names A's ${id}`).not.toContain(id);
  expect(reply.body).not.toContain(a.word);
}

const named = (en: string) => ({ en, hi: en });
const noun = (word: string) => ({
  en: { one: word, other: `${word}s` },
  hi: { one: word, other: word },
});

/** A tenant with an admin, a member on a bound phone, its own role and designation, and its own words. */
async function tenant(name: string, word: string): Promise<Tenant> {
  const tenantId = await world.tenant(name);
  const adminPhone = newPhone();
  const adminUser = await world.user(tenantId, {
    name: `${name} Admin`,
    phone: adminPhone,
    designation: 'head',
    role: 'tenant_admin',
  });
  const memberPhone = newPhone();
  const memberUser = await world.user(tenantId, {
    name: `${name} Member`,
    phone: memberPhone,
    managerId: adminUser.id,
  });
  const memberDevice = newDevice();
  await world.signIn(memberPhone, memberDevice);
  const token = (await world.signIn(adminPhone)).accessToken;
  const role = await send(token, 'POST', '/v1/roles', {
    key: 'cross_role',
    name: named(`${name} role`),
    scope: 'team',
    permissions: ['user.view'],
  });
  const designation = await send(token, 'POST', '/v1/designations', {
    key: 'cross_designation',
    name: noun(`${name} title`),
    level: 5,
    defaultRole: 'cross_role',
    canHaveReports: false,
  });
  expect([role.statusCode, designation.statusCode]).toEqual([201, 201]);
  await send(token, 'PUT', '/v1/terminology', { 'term.account': noun(word) });
  await send(token, 'PATCH', '/v1/settings', { geofenceRadiusMeters: 250 });
  return {
    tenantId,
    admin: { id: adminUser.id, phone: adminPhone },
    member: { id: memberUser.id, phone: memberPhone },
    memberDevice,
    roleId: role.json().id,
    designationId: designation.json().id,
    word,
  };
}

interface Fixture {
  /** What the route is, for tenancy: sign-in, a read of the caller's own tenant, an ID, a write. */
  kind: 'sign-in' | 'not tenant data' | 'own tenant' | 'by ID' | 'write';
  run: () => Promise<void>;
}

const FIXTURES: Record<string, Fixture> = {
  'GET /health': {
    kind: 'not tenant data',
    run: async () => holdsNothingOfA(await send(undefined, 'GET', '/health')),
  },
  'GET /ready': {
    kind: 'not tenant data',
    run: async () => holdsNothingOfA(await send(undefined, 'GET', '/ready')),
  },
  'GET /auth/v1/jwks': {
    kind: 'not tenant data',
    run: async () => holdsNothingOfA(await send(undefined, 'GET', '/auth/v1/jwks')),
  },
  'POST /auth/v1/otp/request': {
    kind: 'sign-in',
    run: async () => {
      // A's number is answered like a number nobody has (M1, rule 2).
      const theirs = await send(undefined, 'POST', '/auth/v1/otp/request', {
        phone: a.admin.phone,
      });
      const nobody = await send(undefined, 'POST', '/auth/v1/otp/request', { phone: newPhone() });
      expect(theirs.statusCode).toBe(202);
      expect(theirs.json()).toEqual(nobody.json());
    },
  },
  'POST /auth/v1/otp/verify': {
    kind: 'sign-in',
    run: async () => {
      const verified = await world.verify(b.admin.phone);
      expect(verified.json()).toMatchObject({ status: 'signed_in', tenant: { id: b.tenantId } });
      holdsNothingOfA(verified);
    },
  },
  'POST /auth/v1/select-tenant': {
    kind: 'sign-in',
    run: async () => {
      // Someone in B and a third tenant can't choose A with their ticket.
      const phone = newPhone();
      await world.member(phone, [b.tenantId, await world.tenant('Third Traders')]);
      await sameAsNowhere(async (tenantId) => {
        const ticket = (await world.verify(phone)).json().ticket as string;
        return send(undefined, 'POST', '/auth/v1/select-tenant', { ticket, tenantId });
      }, a.tenantId);
    },
  },
  'POST /auth/v1/token/refresh': {
    kind: 'sign-in',
    run: async () => {
      const { refreshToken } = await world.signIn(b.admin.phone);
      const refreshed = await send(undefined, 'POST', '/auth/v1/token/refresh', { refreshToken });
      expect(refreshed.json()).toMatchObject({ tenant: { id: b.tenantId } });
      holdsNothingOfA(refreshed);
    },
  },
  'POST /auth/v1/switch-tenant': {
    kind: 'sign-in',
    run: () =>
      sameAsNowhere(async (tenantId) => {
        const { refreshToken } = await world.signIn(b.admin.phone);
        return send(undefined, 'POST', '/auth/v1/switch-tenant', { refreshToken, tenantId });
      }, a.tenantId),
  },
  'POST /auth/v1/logout': {
    kind: 'sign-in',
    run: async () => {
      const { refreshToken } = await world.signIn(b.admin.phone);
      expect((await send(undefined, 'POST', '/auth/v1/logout', { refreshToken })).statusCode).toBe(
        204,
      );
    },
  },
  'GET /v1/me': {
    kind: 'own tenant',
    run: async () => {
      const me = await asB('GET', '/v1/me');
      expect(me.json()).toMatchObject({ tenantId: b.tenantId, userId: b.admin.id });
      holdsNothingOfA(me);
    },
  },
  'GET /v1/config': {
    kind: 'own tenant',
    run: async () => {
      const config = await asB('GET', '/v1/config');
      expect(config.statusCode).toBe(200);
      expect(config.body).toContain(b.word);
      holdsNothingOfA(config);
    },
  },
  'PATCH /v1/settings': {
    kind: 'write',
    run: async () => {
      expect((await asB('PATCH', '/v1/settings', { geofenceRadiusMeters: 400 })).statusCode).toBe(
        200,
      );
    },
  },
  'GET /v1/terminology': {
    kind: 'own tenant',
    run: async () => {
      const words = await asB('GET', '/v1/terminology');
      expect(words.body).toContain(b.word);
      holdsNothingOfA(words);
    },
  },
  'PUT /v1/terminology': {
    kind: 'write',
    run: async () => {
      const replaced = await asB('PUT', '/v1/terminology', { 'term.account': noun(b.word) });
      expect(replaced.statusCode).toBe(200);
      holdsNothingOfA(replaced);
    },
  },
  'GET /v1/roles': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/roles')),
  },
  'POST /v1/roles': {
    kind: 'write',
    run: async () => {
      const created = await asB('POST', '/v1/roles', {
        key: 'b_only_role',
        name: named('B only'),
        scope: 'self',
        permissions: ['user.view'],
      });
      expect(created.statusCode).toBe(201);
      holdsNothingOfA(created);
    },
  },
  'PATCH /v1/roles/:id': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (id) => asB('PATCH', `/v1/roles/${id}`, { name: named('Taken over') }),
        a.roleId,
      ),
  },
  'GET /v1/designations': {
    kind: 'own tenant',
    run: async () => holdsNothingOfA(await asB('GET', '/v1/designations')),
  },
  'POST /v1/designations': {
    kind: 'write',
    run: async () => {
      const created = await asB('POST', '/v1/designations', {
        key: 'b_only_title',
        name: noun('B title'),
        level: 6,
        defaultRole: 'cross_role',
        canHaveReports: false,
      });
      expect(created.statusCode).toBe(201);
      holdsNothingOfA(created);
    },
  },
  'PATCH /v1/designations/:id': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere((id) => asB('PATCH', `/v1/designations/${id}`, { level: 7 }), a.designationId),
  },
  'GET /v1/users': {
    kind: 'own tenant',
    run: async () => {
      holdsNothingOfA(await asB('GET', '/v1/users'));
      // A cursor naming one of A's users still pages through B's.
      holdsNothingOfA(await asB('GET', `/v1/users?cursor=${a.member.id}`));
    },
  },
  'POST /v1/users': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere(
        (managerId) =>
          asB('POST', '/v1/users', {
            code: `X${newId().slice(-8)}`,
            name: 'Crossing Over',
            designation: 'manager',
            managerId,
          }),
        a.admin.id,
      ),
  },
  'GET /v1/users/:id': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('GET', `/v1/users/${id}`), a.member.id),
  },
  'PATCH /v1/users/:id': {
    kind: 'by ID',
    run: async () => {
      await sameAsNowhere(
        (id) => asB('PATCH', `/v1/users/${id}`, { name: 'Taken Over' }),
        a.member.id,
      );
      // Nor can B report one of its people to someone of A's.
      await sameAsNowhere(
        (managerId) => asB('PATCH', `/v1/users/${b.member.id}`, { managerId }),
        a.admin.id,
      );
    },
  },
  'POST /v1/users/:id/reset-device': {
    kind: 'by ID',
    run: () => sameAsNowhere((id) => asB('POST', `/v1/users/${id}/reset-device`), a.member.id),
  },
  'POST /v1/users/:id/sign-out-everywhere': {
    kind: 'by ID',
    run: () =>
      sameAsNowhere((id) => asB('POST', `/v1/users/${id}/sign-out-everywhere`), a.member.id),
  },
  'GET /v1/sync/pull': {
    kind: 'own tenant',
    run: async () => {
      const pulled = await asB('GET', '/v1/sync/pull?entities=users,territories');
      expect(pulled.statusCode).toBe(200);
      holdsNothingOfA(pulled);
      // A cursor A was given is no more use to B than one made up.
      const reused = await asB('GET', `/v1/sync/pull?entities=users&cursor=${aCursor}`);
      const madeUp = await asB('GET', '/v1/sync/pull?entities=users&cursor=bm90IGEgY3Vyc29y');
      expect(reused.statusCode).toBe(410);
      expect(errorOf(reused)).toEqual(errorOf(madeUp));
    },
  },
  'POST /v1/devices/heartbeat': {
    kind: 'write',
    run: async () => {
      const { accessToken } = await world.signIn(b.member.phone, b.memberDevice);
      const beat = await send(accessToken, 'POST', '/v1/devices/heartbeat', {
        appVersion: '0.1.0',
        osVersion: '15',
        queue: { queued: 0, parked: 0, oldestQueuedAt: null },
        lastSyncAt: null,
      });
      expect(beat.statusCode).toBe(204);
    },
  },
  'GET /v1/audit': {
    kind: 'own tenant',
    run: async () => {
      holdsNothingOfA(await asB('GET', '/v1/audit'));
      holdsNothingOfA(await asB('GET', `/v1/audit?actorId=${a.admin.id}`));
      holdsNothingOfA(await asB('GET', `/v1/audit?targetId=${a.member.id}`));
    },
  },
};

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
  a = await tenant('Alpha Agencies', 'Alphastore');
  b = await tenant('Bravo Brands', 'Bravostall');
  bToken = (await world.signIn(b.admin.phone)).accessToken;
  // A sync cursor of A's, made before A's rows are taken down, since signing in writes some.
  const aToken = (await world.signIn(a.admin.phone)).accessToken;
  aCursor = (await send(aToken, 'GET', '/v1/sync/pull?entities=users')).json().cursor;
  aRows = await rowsOf(a.tenantId);
  const theirs = idsIn(await rowsOf(b.tenantId));
  aIds = [...idsIn(aRows)].filter((id) => !theirs.has(id));
});

afterAll(async () => {
  await world.end();
  await app.close();
});

describe('the cross-tenant contract test (spec 14.4)', () => {
  it('has a fixture for every route, and none for a route that is gone', () => {
    const keys = routes.map((route) => route.key);
    expect(keys.filter((key) => !(key in FIXTURES))).toEqual([]);
    expect(Object.keys(FIXTURES).filter((key) => !keys.includes(key))).toEqual([]);
  });

  it('covers every route the running app serves', () => {
    const served = new Set<string>();
    for (const module of app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const prototype = Object.getPrototypeOf(wrapper.instance) as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler = Object.getOwnPropertyDescriptor(prototype, name)?.value;
          if (name === 'constructor' || typeof handler !== 'function') continue;
          if (Reflect.getMetadata('path', handler) !== undefined) {
            served.add(`${wrapper.name}.${name}`);
          }
        }
      }
    }
    expect([...served].sort()).toEqual(routes.map((route) => route.handler).sort());
  });

  it('starts from two tenants that each have people, roles, words and settings of their own', () => {
    expect(aIds.length).toBeGreaterThan(10);
    expect(Object.values(aRows).flat().length).toBeGreaterThan(20);
  });

  for (const route of routes) {
    const fixture = FIXTURES[route.key];
    it.runIf(fixture)(`${route.key} (${fixture?.kind}) leaves tenant A untouched`, async () => {
      await fixture!.run();
      expect(await rowsOf(a.tenantId)).toEqual(aRows);
    });
  }
});

describe('the checks themselves', () => {
  // Tenant A's own admin reaches A, so every check must trip; a check that can't fail proves nothing.
  const aAdmin = async () => (await world.signIn(a.admin.phone)).accessToken;

  it('see A in a read', async () => {
    const read = await send(await aAdmin(), 'GET', '/v1/users');
    expect(() => holdsNothingOfA(read)).toThrow();
  });

  it('see an ID of A that answers', async () => {
    const token = await aAdmin();
    await expect(
      sameAsNowhere((id) => send(token, 'GET', `/v1/users/${id}`), a.member.id),
    ).rejects.toThrow();
  });

  it('see a write to A', async () => {
    await send(await aAdmin(), 'PATCH', `/v1/users/${a.member.id}`, { name: 'Changed By A' });
    expect(await rowsOf(a.tenantId)).not.toEqual(aRows);
    aRows = await rowsOf(a.tenantId);
  });
});
