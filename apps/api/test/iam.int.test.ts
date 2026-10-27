import { newId, NUMBER_IN_USE } from '@thelamp/shared';
import { ModulesContainer, Reflector } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { SigningKey } from '../src/modules/directory/signing-key';
import { accessRule } from '../src/platform/auth';
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

interface Person {
  id: string;
  phone: string;
}

/**
 * A tenant with an admin and this reporting tree:
 *
 *     head ── m ── a ── f1
 *         └── p ── f2
 *
 * `m`, `a` and `p` are managers (team scope); `f1` and `f2` are field users (self scope, mobile
 * only); `head` is the business head.
 */
async function org(name: string) {
  const tenantId = await world.tenant(name);
  const make = async (input: NewUser): Promise<Person> => {
    const phone = newPhone();
    const user = await world.user(tenantId, { phone, ...input });
    return { id: user.id, phone };
  };
  const admin = await make({ name: 'Asha Admin', designation: 'head', role: 'tenant_admin' });
  const head = await make({ name: 'Hari Head', designation: 'head' });
  const m = await make({ name: 'Meena Manager', managerId: head.id });
  const a = await make({ name: 'Arun Area', managerId: m.id });
  const f1 = await make({ name: 'Farid Field', designation: 'executive', managerId: a.id });
  const p = await make({ name: 'Pooja Peer', managerId: head.id });
  const f2 = await make({ name: 'Faye Field', designation: 'executive', managerId: p.id });
  return { tenantId, admin, head, m, a, f1, p, f2, make };
}

/** Requests as one signed-in caller. Writes carry a fresh idempotency key unless given one. */
function as(token: string) {
  const send = (
    method: 'GET' | 'POST' | 'PATCH',
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
    get: (url: string) => send('GET', url),
    post: (url: string, payload?: object, key: string = newId()) =>
      send('POST', url, payload, { 'idempotency-key': key }),
    patch: (url: string, payload: object) => send('PATCH', url, payload),
  };
}

const web = async (person: Person) => as((await world.signIn(person.phone)).accessToken);
/** Signed in on the web with a fresh authenticator code, as changing a phone needs (D101). */
const stepped = async (person: Person) =>
  as(await world.stepUp(person.phone, (await world.signIn(person.phone)).accessToken));
const code = (response: { json: () => unknown }) =>
  (response.json() as { error?: { code: string } }).error?.code;
const ids = (response: { json: () => unknown }) =>
  (response.json() as { items: { id: string }[] }).items.map((user) => user.id).sort();

async function asAdmin<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: inject('databaseUrls').admin });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

describe('signing in on a phone (M1, rule 5; BR-38)', () => {
  it('binds the first phone and refuses another until the binding is reset', async () => {
    const { a, f1 } = await org('Bandhan Agro');
    const first = newDevice('First phone');
    const second = newDevice('Second phone');

    const one = await world.signIn(f1.phone, first);
    const me = await as(one.accessToken).get('/v1/me');
    expect(me.statusCode).toBe(200);
    const boundId = me.json().deviceId;
    expect(boundId).toEqual(expect.any(String));

    const refused = await world.verify(f1.phone, second);
    expect(refused.statusCode).toBe(409);
    expect(code(refused)).toBe('DEVICE_NOT_BOUND');
    // The bound phone itself signs in again as often as it likes.
    const again = await world.signIn(f1.phone, first);
    expect((await as(again.accessToken).get('/v1/me')).json().deviceId).toBe(boundId);

    const manager = await web(a);
    expect((await manager.post(`/v1/users/${f1.id}/reset-device`)).statusCode).toBe(204);

    // The old phone's tokens fail on their next use, and its refresh token is dead.
    expect(code(await as(one.accessToken).get('/v1/me'))).toBe('SESSION_REVOKED');
    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/v1/token/refresh',
      payload: { refreshToken: again.refreshToken },
    });
    expect(code(refreshed)).toBe('SESSION_REVOKED');

    // The new phone binds, and now the old one is the stranger.
    const moved = await world.signIn(f1.phone, second);
    const now = await as(moved.accessToken).get('/v1/me');
    expect(now.statusCode).toBe(200);
    expect(now.json().deviceId).not.toBe(boundId);
    expect(code(await world.verify(f1.phone, first))).toBe('DEVICE_NOT_BOUND');
  });

  it('keeps people whose role is mobile-only off the web (M1, rule 9)', async () => {
    const { tenantId, m, f1 } = await org('Chirag Seeds');
    const refused = await world.verify(f1.phone);
    expect(refused.statusCode).toBe(403);
    expect(code(refused)).toBe('USE_MOBILE_APP');

    // A token without a device fares no better on the cell.
    const { token } = await app
      .get(SigningKey)
      .sign({ userId: f1.id, tenantId, cell: 'local', revision: 0 });
    expect(code(await as(token).get('/v1/me'))).toBe('USE_MOBILE_APP');

    // Managers may use the web, and web sessions are never bound.
    const manager = await web(m);
    expect((await manager.get('/v1/me')).json()).toMatchObject({ role: 'manager', deviceId: null });
  });
});

describe('every request (M1, rule 7; BR-39)', () => {
  it('ends every session of a deactivated user, and sends them no code', async () => {
    const { admin, make, p } = await org('Dhanya Inputs');
    const leaver = await make({ name: 'Lata Leaver', managerId: p.id });
    const onWeb = await world.signIn(leaver.phone);
    const onPhone = await world.signIn(leaver.phone, newDevice());
    expect((await as(onWeb.accessToken).get('/v1/me')).statusCode).toBe(200);

    const done = await (await web(admin)).patch(`/v1/users/${leaver.id}`, { status: 'inactive' });
    expect(done.json()).toMatchObject({ status: 'inactive' });

    for (const session of [onWeb, onPhone]) {
      expect(code(await as(session.accessToken).get('/v1/me'))).toBe('SESSION_REVOKED');
      const refreshed = await app.inject({
        method: 'POST',
        url: '/auth/v1/token/refresh',
        payload: { refreshToken: session.refreshToken },
      });
      expect(code(refreshed)).toBe('SESSION_REVOKED');
    }
    const sent = world.sender.sent.length;
    expect((await world.verify(leaver.phone)).statusCode).toBe(400);
    expect(world.sender.sent).toHaveLength(sent);

    await (await web(admin)).patch(`/v1/users/${leaver.id}`, { status: 'active' });
    expect((await world.verify(leaver.phone)).statusCode).toBe(200);
  });

  it('ends sessions when a role or phone number changes', async () => {
    const { admin, make, p } = await org('Ekam Krishi');
    const person = await make({ name: 'Ravi Role', managerId: p.id });
    const owner = await web(admin);

    const before = await world.signIn(person.phone);
    await owner.patch(`/v1/users/${person.id}`, { role: 'viewer' });
    expect(code(await as(before.accessToken).get('/v1/me'))).toBe('SESSION_REVOKED');
    const after = await world.signIn(person.phone);
    expect((await as(after.accessToken).get('/v1/me')).json().role).toBe('viewer');

    const newNumber = newPhone();
    // Without a fresh authenticator code the number stays (D101).
    const refused = await owner.patch(`/v1/users/${person.id}`, { phone: newNumber.slice(3) });
    expect(code(refused)).toBe('SECOND_FACTOR_REQUIRED');
    const changed = await (
      await stepped(admin)
    ).patch(`/v1/users/${person.id}`, {
      phone: newNumber.slice(3),
    });
    expect(changed.json().phone).toBe(newNumber);
    expect(code(await as(after.accessToken).get('/v1/me'))).toBe('SESSION_REVOKED');
    // The old number no longer signs in; the new one does, as the same user.
    expect((await world.verify(person.phone)).statusCode).toBe(400);
    const moved = await world.signIn(newNumber);
    expect((await as(moved.accessToken).get('/v1/me')).json().userId).toBe(person.id);
  });

  it('signs a user out everywhere on request, within scope', async () => {
    const { m, a, f1, p } = await org('Gauri Agro');
    const field = await world.signIn(f1.phone, newDevice());
    const manager = await web(m);
    expect((await manager.post(`/v1/users/${f1.id}/sign-out-everywhere`)).statusCode).toBe(204);
    expect(code(await as(field.accessToken).get('/v1/me'))).toBe('SESSION_REVOKED');

    expect(code(await manager.post(`/v1/users/${p.id}/sign-out-everywhere`))).toBe('OUT_OF_SCOPE');
    // Signing yourself out everywhere is allowed.
    const self = await web(a);
    expect((await self.post(`/v1/users/${a.id}/sign-out-everywhere`)).statusCode).toBe(204);
    expect(code(await self.get('/v1/me'))).toBe('SESSION_REVOKED');
  });

  it('refuses every request while the tenant is suspended', async () => {
    const { tenantId, m } = await org('Himalaya Seeds');
    const manager = await web(m);
    const setStatus = (status: string) =>
      world.directory.client.query('update directory.tenants set status = $1 where id = $2', [
        status,
        tenantId,
      ]);
    await setStatus('suspended');
    const refused = await manager.get('/v1/me');
    expect(refused.statusCode).toBe(423);
    expect(code(refused)).toBe('TENANT_SUSPENDED');
    await setStatus('active');
    expect((await manager.get('/v1/me')).statusCode).toBe(200);
  });
});

describe('resetting a device (M3)', () => {
  it('is for a manager above the user or an admin, and never for oneself', async () => {
    const { admin, head, m, a, f1, p } = await org('Indra Krishi');
    const manager = await web(m);
    expect((await manager.post(`/v1/users/${a.id}/reset-device`)).statusCode).toBe(204);
    expect((await manager.post(`/v1/users/${f1.id}/reset-device`)).statusCode).toBe(204);
    expect(code(await manager.post(`/v1/users/${p.id}/reset-device`))).toBe('OUT_OF_SCOPE');
    expect(code(await manager.post(`/v1/users/${head.id}/reset-device`))).toBe('OUT_OF_SCOPE');
    const own = await manager.post(`/v1/users/${m.id}/reset-device`);
    expect(own.statusCode).toBe(403);
    expect(code(own)).toBe('FORBIDDEN');

    expect((await (await web(admin)).post(`/v1/users/${p.id}/reset-device`)).statusCode).toBe(204);
    const field = as((await world.signIn(f1.phone, newDevice())).accessToken);
    expect(code(await field.post(`/v1/users/${f1.id}/reset-device`))).toBe('FORBIDDEN');
  });

  it('happens once per idempotency key, and needs one', async () => {
    const { a, f1 } = await org('Jyoti Agri');
    const { accessToken } = await world.signIn(a.phone);
    const manager = as(accessToken);
    const missing = await app.inject({
      method: 'POST',
      url: `/v1/users/${f1.id}/reset-device`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(code(missing)).toBe('VALIDATION');

    const key = newId();
    expect((await manager.post(`/v1/users/${f1.id}/reset-device`, undefined, key)).statusCode).toBe(
      204,
    );
    // The user binds a new phone; a retried request with the same key must not undo that.
    const fresh = await world.signIn(f1.phone, newDevice());
    expect((await manager.post(`/v1/users/${f1.id}/reset-device`, undefined, key)).statusCode).toBe(
      204,
    );
    expect((await as(fresh.accessToken).get('/v1/me')).statusCode).toBe(200);
  });
});

describe('managing users (spec 5.3)', () => {
  it("creates a user once per key, with the designation's default role", async () => {
    const { admin, a } = await org('Kalpa Seeds');
    const owner = await web(admin);
    const phone = newPhone();
    const body = {
      code: 'SO-0042',
      name: 'Neha Nair',
      phone: phone.slice(3),
      designation: 'executive',
      managerId: a.id,
      joiningDate: '2026-04-01',
    };
    const key = newId();
    const created = await owner.post('/v1/users', body, key);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      code: 'SO-0042',
      phone,
      designation: 'executive',
      role: 'field_user',
      managerId: a.id,
      status: 'active',
      joiningDate: '2026-04-01',
      exitDate: null,
    });
    const again = await owner.post('/v1/users', body, key);
    expect(again.json()).toEqual(created.json());

    // The new user can sign in on a phone straight away.
    const session = await world.signIn(phone, newDevice());
    expect((await as(session.accessToken).get('/v1/me')).json()).toMatchObject({
      userId: created.json().id,
      name: 'Neha Nair',
      role: 'field_user',
      scope: 'self',
    });
  });

  it('keeps codes and mobile numbers unique in a tenant, but not across tenants', async () => {
    const one = await org('Lakshmi Agro');
    const two = await org('Madhu Krishi');
    const owner = await web(one.admin);
    const taken = await owner.post('/v1/users', {
      code: 'X-1',
      name: 'Om Prakash',
      phone: one.f1.phone,
      designation: 'executive',
      managerId: one.a.id,
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.details).toEqual([
      { path: 'phone', issue: 'Another user has this mobile number' },
    ]);
    await owner.post('/v1/users', { code: 'X-1', name: 'Om Prakash', designation: 'head' });
    const sameCode = await owner.post('/v1/users', {
      code: 'X-1',
      name: 'Om Two',
      designation: 'head',
    });
    expect(sameCode.json().error.details).toEqual([
      { path: 'code', issue: 'Another user has this code' },
    ]);

    // Another tenant may use the same code, but not a number someone signs in with here: a
    // person belongs to one organisation (D103), and the refusal doesn't say which.
    const otherAdmin = await web(two.admin);
    const sameNumber = await otherAdmin.post('/v1/users', {
      code: 'X-1',
      name: 'Om Prakash',
      phone: one.f1.phone,
      designation: 'head',
    });
    expect(sameNumber.statusCode).toBe(409);
    expect(sameNumber.json().error.details).toEqual([{ path: 'phone', issue: NUMBER_IN_USE }]);
    const other = await otherAdmin.post('/v1/users', {
      code: 'X-1',
      name: 'Om Prakash',
      designation: 'head',
    });
    expect(other.statusCode).toBe(201);
  });

  it('checks the manager: real, active, able to have reports, and not below the user', async () => {
    const { admin, m, a, f1, make, head } = await org('Nandi Inputs');
    const owner = await web(admin);
    const issue = async (response: Promise<{ json: () => unknown }>) =>
      ((await response).json() as { error: { details: { issue: string }[] } }).error.details[0]
        ?.issue;

    const base = { name: 'Uma Under', designation: 'executive' };
    expect(await issue(owner.post('/v1/users', { ...base, code: 'U1', managerId: f1.id }))).toBe(
      "This manager's designation cannot have reports",
    );
    expect(await issue(owner.post('/v1/users', { ...base, code: 'U2', managerId: newId() }))).toBe(
      'There is no user with this ID',
    );
    expect(await issue(owner.patch(`/v1/users/${m.id}`, { managerId: a.id }))).toBe(
      'This would make a reporting loop',
    );
    expect(await issue(owner.patch(`/v1/users/${m.id}`, { managerId: m.id }))).toBe(
      'This would make a reporting loop',
    );

    const gone = await make({ name: 'Ira Inactive', managerId: head.id });
    await owner.patch(`/v1/users/${gone.id}`, { status: 'inactive' });
    expect(await issue(owner.post('/v1/users', { ...base, code: 'U3', managerId: gone.id }))).toBe(
      'This manager is inactive',
    );

    // A manager with active reports stays active until the reports move.
    const busy = await owner.patch(`/v1/users/${a.id}`, { status: 'inactive' });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.details).toEqual([
      { path: 'status', issue: 'This person has active reports' },
    ]);
  });

  it('moves a whole team, and scopes follow the reporting tree', async () => {
    const { tenantId, admin, head, m, a, f1, p, f2 } = await org('Ojas Agro');
    const owner = await web(admin);
    const lists = async () => ({
      m: ids(await (await web(m)).get('/v1/users')),
      p: ids(await (await web(p)).get('/v1/users')),
    });
    expect(await lists()).toEqual({
      m: [m.id, a.id, f1.id].sort(),
      p: [p.id, f2.id].sort(),
    });

    expect((await owner.patch(`/v1/users/${a.id}`, { managerId: p.id })).statusCode).toBe(200);
    expect(await lists()).toEqual({
      m: [m.id],
      p: [p.id, f2.id, a.id, f1.id].sort(),
    });
    expect((await (await web(p)).post(`/v1/users/${f1.id}/reset-device`)).statusCode).toBe(204);
    expect(code(await (await web(m)).post(`/v1/users/${f1.id}/reset-device`))).toBe('OUT_OF_SCOPE');

    await owner.patch(`/v1/users/${p.id}`, { managerId: m.id });
    await owner.patch(`/v1/users/${m.id}`, { managerId: null });
    expect(ids(await (await web(head)).get('/v1/users'))).toHaveLength(7);

    // After every move, the closure is exactly the transitive closure of the manager links.
    const derived = await asAdmin(
      `with recursive chain(ancestor_id, descendant_id, depth) as (
         select id, id, 0 from cell.users where tenant_id = $1
         union all
         select chain.ancestor_id, u.id, chain.depth + 1
           from chain join cell.users u on u.tenant_id = $1 and u.manager_id = chain.descendant_id)
       select ancestor_id, descendant_id, depth from chain order by 1, 2`,
      [tenantId],
    );
    const stored = await asAdmin(
      `select ancestor_id, descendant_id, depth from cell.reporting_closure
        where tenant_id = $1 order by 1, 2`,
      [tenantId],
    );
    expect(stored).toEqual(derived);
  });

  it('pages through users and gives every change a new row version', async () => {
    const { tenantId, admin, f2 } = await org('Prakriti Seeds');
    const owner = await web(admin);
    const first = await owner.get('/v1/users?limit=4');
    expect(first.json().items).toHaveLength(4);
    const next = await owner.get(`/v1/users?limit=4&cursor=${first.json().nextCursor}`);
    expect(next.json().items).toHaveLength(3);
    expect(next.json().nextCursor).toBeNull();
    expect(new Set([...ids(first), ...ids(next)]).size).toBe(7);

    const version = async () =>
      Number(
        (
          await asAdmin<{ row_version: string }>(
            'select row_version from cell.users where tenant_id = $1 and id = $2',
            [tenantId, f2.id],
          )
        )[0]!.row_version,
      );
    const before = await version();
    await owner.patch(`/v1/users/${f2.id}`, { name: 'Faye Fernandes' });
    expect(await version()).toBeGreaterThan(before);
  });

  it("answers another tenant's users as not found", async () => {
    const one = await org('Quill Agro');
    const two = await org('Rasa Krishi');
    const owner = await web(one.admin);
    expect(code(await owner.get(`/v1/users/${two.f1.id}`))).toBe('NOT_FOUND');
    expect(code(await owner.patch(`/v1/users/${two.f1.id}`, { name: 'Taken Over' }))).toBe(
      'NOT_FOUND',
    );
    expect(code(await owner.post(`/v1/users/${two.f1.id}/reset-device`))).toBe('NOT_FOUND');
    const planted = await owner.post('/v1/users', {
      code: 'PLANT',
      name: 'Plant Person',
      designation: 'executive',
      managerId: two.a.id,
    });
    expect(planted.json().error.details[0].issue).toBe('There is no user with this ID');
    expect(code(await owner.get('/v1/users/not-a-uuid'))).toBe('NOT_FOUND');
  });
});

describe('scopes (spec 4.2)', () => {
  it('limit reads to what the role reaches, and permissions to what it holds', async () => {
    const { admin, m, a, f1 } = await org('Sarita Agro');
    expect(ids(await (await web(admin)).get('/v1/users'))).toHaveLength(7);
    const manager = await web(m);
    expect((await manager.get(`/v1/users/${f1.id}`)).statusCode).toBe(200);
    expect(code(await manager.get(`/v1/users/${admin.id}`))).toBe('OUT_OF_SCOPE');
    // Field users may not list people at all, and managers may not create them.
    const field = as((await world.signIn(f1.phone, newDevice())).accessToken);
    expect(code(await field.get('/v1/users'))).toBe('FORBIDDEN');
    expect(
      code(
        await manager.post('/v1/users', { code: 'NEW', name: 'New Person', designation: 'head' }),
      ),
    ).toBe('FORBIDDEN');
    expect(code(await (await web(a)).get('/v1/roles'))).toBe('FORBIDDEN');
  });

  it('reach everyone attached at or below the territories a user works in, today', async () => {
    const { tenantId, admin, head } = await org('Tara Inputs');
    const created = await (
      await web(admin)
    ).post('/v1/roles', {
      key: 'area_viewer',
      name: { en: 'Area viewer', hi: 'क्षेत्र दर्शक' },
      scope: 'territory',
      permissions: ['user.view'],
    });
    expect(created.statusCode).toBe(201);

    const north = await world.territory(tenantId, 'NORTH');
    const east = await world.territory(tenantId, 'EAST', north);
    const west = await world.territory(tenantId, 'WEST', north);
    const south = await world.territory(tenantId, 'SOUTH');
    const deep = await world.territory(tenantId, 'SOUTH-1', south);

    const person = (name: string) =>
      world.user(tenantId, { name, designation: 'manager', managerId: head.id });
    const watcher = await world.user(tenantId, {
      name: 'Vani Viewer',
      designation: 'manager',
      role: 'area_viewer',
      managerId: head.id,
    });
    const inEast = await person('Esha East');
    const inWest = await person('Wasim West');
    const inSouth = await person('Sunil South');
    const later = await person('Lalit Later');
    const earlier = await person('Ela Earlier');
    await world.attach(tenantId, watcher.id, north);
    await world.attach(tenantId, inEast.id, east);
    await world.attach(tenantId, inWest.id, west);
    await world.attach(tenantId, inSouth.id, deep);
    await world.attach(tenantId, later.id, east, '2999-01-01');
    await world.attach(tenantId, earlier.id, west, '2020-01-01', '2021-01-01');

    const viewer = as((await world.signIn(watcher.phone!)).accessToken);
    expect(ids(await viewer.get('/v1/users'))).toEqual([watcher.id, inEast.id, inWest.id].sort());
    expect(code(await viewer.get(`/v1/users/${inSouth.id}`))).toBe('OUT_OF_SCOPE');
  });
});

describe('giving access (spec 4.2)', () => {
  it('never lets anyone give or change access beyond their own', async () => {
    const { admin, head, p } = await org('Usha Agro');
    const business = await web(head);
    expect(
      code(
        await business.post('/v1/users', {
          code: 'ESC',
          name: 'Esha Escalate',
          designation: 'head',
          role: 'tenant_admin',
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(code(await business.patch(`/v1/users/${admin.id}`, { name: 'Renamed' }))).toBe(
      'FORBIDDEN',
    );
    expect((await business.patch(`/v1/users/${p.id}`, { name: 'Pooja Prasad' })).statusCode).toBe(
      200,
    );

    const owner = await web(admin);
    expect(code(await owner.patch(`/v1/users/${admin.id}`, { status: 'inactive' }))).toBe(
      'FORBIDDEN',
    );
    expect(code(await owner.patch(`/v1/users/${admin.id}`, { role: 'viewer' }))).toBe('FORBIDDEN');
    // Sending your own role back unchanged, as a profile form might, is not a change.
    const unchanged = await owner.patch(`/v1/users/${admin.id}`, {
      name: 'Asha Agarwal',
      role: 'tenant_admin',
      status: 'active',
    });
    expect(unchanged.json()).toMatchObject({ name: 'Asha Agarwal', role: 'tenant_admin' });

    const roles = (await owner.get('/v1/roles')).json().items as { id: string; key: string }[];
    const byKey = Object.fromEntries(roles.map((role) => [role.key, role.id]));
    expect(
      code(
        await business.post('/v1/roles', {
          key: 'payer',
          name: { en: 'Payer', hi: 'भुगतानकर्ता' },
          scope: 'tenant',
          permissions: ['billing.manage'],
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(code(await business.patch(`/v1/roles/${byKey.business_head}`, { scope: 'team' }))).toBe(
      'FORBIDDEN',
    );
    // Nobody edits the role they hold, the tenant admin included.
    const own = await owner.patch(`/v1/roles/${byKey.tenant_admin}`, {
      name: { en: 'Owner', hi: 'स्वामी' },
    });
    expect(code(own)).toBe('FORBIDDEN');
    const locked = await business.patch(`/v1/roles/${byKey.tenant_admin}`, { scope: 'team' });
    expect(locked.json().error.details).toEqual([
      { path: 'scope', issue: 'The tenant admin always holds every permission across the tenant' },
    ]);
  });
});

describe('roles and designations', () => {
  it('start from the template, and the tenant adds its own', async () => {
    const { admin, f1 } = await org('Vidya Seeds');
    const owner = await web(admin);
    const roles = (await owner.get('/v1/roles')).json().items as { key: string; system: boolean }[];
    expect(roles.map((role) => role.key)).toEqual([
      'tenant_admin',
      'business_head',
      'manager',
      'field_user',
      'back_office',
      'viewer',
    ]);
    expect(roles.every((role) => role.system)).toBe(true);

    const field = as((await world.signIn(f1.phone, newDevice())).accessToken);
    const designations = await field.get('/v1/designations');
    expect(designations.json().items.map((d: { key: string }) => d.key)).toEqual([
      'head',
      'manager',
      'executive',
    ]);

    const role = {
      key: 'auditor',
      name: { en: 'Auditor', hi: 'लेखा परीक्षक' },
      scope: 'tenant',
      permissions: ['report.view', 'audit.view'],
    };
    const created = await owner.post('/v1/roles', role);
    expect(created.json()).toMatchObject({ key: 'auditor', mobileOnly: false, system: false });
    expect(code(await owner.post('/v1/roles', role))).toBe('CONFLICT');

    const designation = {
      key: 'auditor',
      name: {
        en: { one: 'Auditor', other: 'Auditors' },
        hi: { one: 'लेखा परीक्षक', other: 'लेखा परीक्षक' },
      },
      level: 2,
      defaultRole: 'auditor',
      canHaveReports: false,
    };
    const made = await owner.post('/v1/designations', designation);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ key: 'auditor', defaultRole: 'auditor', ranked: false });
    expect(
      (
        await owner.post('/v1/designations', {
          ...designation,
          key: 'other',
          defaultRole: 'nobody',
        })
      ).json().error.details,
    ).toEqual([{ path: 'defaultRole', issue: 'There is no role `nobody`' }]);
  });

  it('keep a designation able to have reports while people with it have reports', async () => {
    const { admin } = await org('Waman Agro');
    const owner = await web(admin);
    const designations = (await owner.get('/v1/designations')).json().items as {
      id: string;
      key: string;
    }[];
    const manager = designations.find((d) => d.key === 'manager')!;
    const refused = await owner.patch(`/v1/designations/${manager.id}`, { canHaveReports: false });
    expect(refused.statusCode).toBe(409);
    expect(
      (await owner.patch(`/v1/designations/${manager.id}`, { ranked: true })).json(),
    ).toMatchObject({ key: 'manager', ranked: true, canHaveReports: true });
  });
});

describe('every route', () => {
  it('declares who may call it', () => {
    const reflector = app.get(Reflector);
    const routes: string[] = [];
    for (const module of app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const prototype = Object.getPrototypeOf(wrapper.instance) as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(prototype)) {
          if (name === 'constructor') continue;
          // Reading a getter would run it; routes are plain methods.
          const handler = Object.getOwnPropertyDescriptor(prototype, name)?.value;
          if (typeof handler !== 'function' || Reflect.getMetadata('path', handler) === undefined) {
            continue;
          }
          routes.push(`${wrapper.name}.${name}`);
          const rule = accessRule(reflector, [handler, wrapper.metatype!]);
          expect(rule, `${wrapper.name}.${name}`).toBeDefined();
        }
      }
    }
    expect(routes.length).toBeGreaterThan(20);
  });
});
