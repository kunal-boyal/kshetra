import { newId } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { newDevice, newPhone, type NewUser, startApp, World } from './support';

let app: NestFastifyApplication;
let world: World;
const urls = inject('databaseUrls');

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

/** A tenant with an admin, a manager and a field user who reports to the manager. */
async function org(name: string) {
  const tenantId = await world.tenant(name);
  const make = async (input: NewUser) => {
    const phone = newPhone();
    const user = await world.user(tenantId, { phone, ...input });
    return { id: user.id, phone };
  };
  const admin = await make({ name: 'Asha Admin', designation: 'head', role: 'tenant_admin' });
  const manager = await make({ name: 'Meena Manager' });
  const field = await make({
    name: 'Farid Field',
    designation: 'executive',
    managerId: manager.id,
  });
  return { tenantId, admin, manager, field, make };
}

function as(token: string) {
  const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === 'POST' ? { 'idempotency-key': newId() } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => send('GET', url),
    post: (url: string, payload?: object) => send('POST', url, payload),
    patch: (url: string, payload: object) => send('PATCH', url, payload),
    put: (url: string, payload: object) => send('PUT', url, payload),
  };
}

const web = async (person: { phone: string }) => as((await world.signIn(person.phone)).accessToken);

interface Entry {
  id: string;
  actor: { kind: string; id: string | null };
  action: string;
  target: { type: string; id: string | null };
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  deviceId: string | null;
  createdAt: string;
}

const entries = async (owner: ReturnType<typeof as>, query: string): Promise<Entry[]> =>
  (await owner.get(`/v1/audit?${query}`)).json().items;

describe('the audit log (module M21)', () => {
  it('records who changed a user, from where, with the values before and after', async () => {
    const { admin, field } = await org('Kalyani Agro');
    const owner = await web(admin);
    await owner.patch(`/v1/users/${field.id}`, { name: 'Farid Faruqui' });

    const [updated] = await entries(owner, `targetId=${field.id}&action=user.updated`);
    expect(updated).toMatchObject({
      actor: { kind: 'user', id: admin.id },
      target: { type: 'user', id: field.id },
      before: { name: 'Farid Field' },
      after: { name: 'Farid Faruqui' },
      ip: '127.0.0.1',
      deviceId: null,
    });
    // The user was made by the system, as provisioning makes the first people.
    const [created] = await entries(owner, `targetId=${field.id}&action=user.created`);
    expect(created).toMatchObject({ actor: { kind: 'system', id: null }, before: null });
  });

  it('records sign-ins, refused phones, device resets and signing out everywhere', async () => {
    const { admin, manager, field } = await org('Lavanya Seeds');
    const phone = newDevice('First phone');
    await world.signIn(field.phone, phone);
    expect((await world.verify(field.phone, newDevice('Borrowed phone'))).statusCode).toBe(409);
    const managing = await web(manager);
    await managing.post(`/v1/users/${field.id}/reset-device`);
    await managing.post(`/v1/users/${field.id}/sign-out-everywhere`);

    const owner = await web(admin);
    const log = await entries(owner, `targetId=${field.id}`);
    expect(log.map((entry) => entry.action)).toEqual([
      'user.signed_out_everywhere',
      'user.device_reset',
      'session.device_refused',
      'session.signed_in',
      'user.created',
    ]);
    const [signedOut, reset, refused, signedIn] = log;
    expect(signedIn!.deviceId).toEqual(signedIn!.after!.deviceId);
    expect(refused!.after).toEqual({ platform: 'android', model: 'Borrowed phone' });
    expect(reset).toMatchObject({
      actor: { id: manager.id },
      after: { revokedDevices: [signedIn!.deviceId] },
    });
    expect(signedOut!.actor.id).toBe(manager.id);
  });

  it('records configuration changes with the values before and after', async () => {
    const { tenantId, admin } = await org('Madhuban Krishi');
    const owner = await web(admin);
    await owner.patch('/v1/settings', { gpsIntervalSeconds: 120 });
    const words = {
      'term.account': {
        en: { one: 'Party', other: 'Parties' },
        hi: { one: 'पार्टी', other: 'पार्टियाँ' },
      },
    };
    await owner.put('/v1/terminology', words);
    const roles = (await owner.get('/v1/roles')).json().items as { id: string; key: string }[];
    const viewer = roles.find((role) => role.key === 'viewer')!;
    await owner.patch(`/v1/roles/${viewer.id}`, { permissions: ['report.view'] });

    const [settings] = await entries(owner, 'action=settings.updated');
    expect(settings).toMatchObject({
      target: { type: 'tenant', id: tenantId },
      before: { gpsIntervalSeconds: 60 },
      after: { gpsIntervalSeconds: 120 },
    });
    const [terms] = await entries(owner, 'action=terminology.replaced');
    expect(terms).toMatchObject({ before: {}, after: words, actor: { id: admin.id } });
    const [role] = await entries(owner, `targetId=${viewer.id}`);
    expect(role!.action).toBe('role.updated');
    expect(role!.after!.permissions).toEqual(['report.view']);
    expect((role!.before!.permissions as string[]).length).toBeGreaterThan(1);
  });

  it('pages from the newest entry, a page at a time', async () => {
    const { admin, field } = await org('Navya Agro');
    const owner = await web(admin);
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      await owner.patch(`/v1/users/${field.id}`, { name: `Farid ${name}` });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: Entry[]; nextCursor: string | null } = (
        await owner.get(
          `/v1/audit?targetId=${field.id}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        )
      ).json();
      seen.push(...page.items.map((entry) => String(entry.after?.name ?? entry.action)));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['Farid Four', 'Farid Three', 'Farid Two', 'Farid One', 'Farid Field']);
    expect((await owner.get('/v1/audit?cursor=not-a-cursor')).json().error.code).toBe('VALIDATION');
  });

  it('shows entries to those with audit.view, within their scope and tenant', async () => {
    const one = await org('Ojaswi Seeds');
    const two = await org('Prabha Krishi');
    expect((await (await web(one.manager)).get('/v1/audit')).json().error.code).toBe('FORBIDDEN');

    // A role that reaches only its team sees what its team did.
    const owner = await web(one.admin);
    await owner.post('/v1/roles', {
      key: 'team_auditor',
      name: { en: 'Team auditor', hi: 'टीम ऑडिटर' },
      scope: 'team',
      permissions: ['audit.view', 'user.view'],
    });
    const lead = await one.make({ name: 'Lata Lead', role: 'team_auditor' });
    const member = await one.make({ name: 'Mohan Member', managerId: lead.id });
    await world.signIn(member.phone);
    await world.signIn(one.manager.phone);
    const actors = (await entries(await web(lead), 'action=session.signed_in')).map(
      (entry) => entry.actor.id,
    );
    expect(actors).toContain(member.id);
    expect(actors).toContain(lead.id);
    expect(actors).not.toContain(one.manager.id);

    // Another tenant's admin never sees these entries.
    expect(await entries(await web(two.admin), `targetId=${one.field.id}`)).toEqual([]);
  });

  it('never lets the application change or remove an entry', async () => {
    const { tenantId } = await org('Rudra Agro');
    const client = new pg.Client({ connectionString: urls.cellApp });
    await client.connect();
    /** Runs one statement as the API would: in a transaction, in the tenant. */
    const attempt = async (statement: string) => {
      await client.query('begin');
      try {
        await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
        return await client.query(statement);
      } finally {
        await client.query('rollback');
      }
    };
    try {
      const { rows } = await attempt('select count(*)::int as n from cell.audit_log');
      expect(rows[0].n).toBeGreaterThan(0);
      await expect(attempt("update cell.audit_log set action = 'forged'")).rejects.toThrow(
        /permission denied/,
      );
      await expect(attempt('delete from cell.audit_log')).rejects.toThrow(/permission denied/);
      const [partition] = (
        await attempt(
          `select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
            where i.inhparent = 'cell.audit_log'::regclass limit 1`,
        )
      ).rows;
      await expect(attempt(`delete from cell.${partition.name}`)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await client.end();
    }
  });

  it("keeps this month and the next two in partitions, created by the database's owner", async () => {
    const admin = new pg.Client({ connectionString: urls.admin });
    await admin.connect();
    try {
      await admin.query('select cell.ensure_audit_log_partitions()');
      const { rows } = await admin.query<{ name: string }>(
        `select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
          where i.inhparent = 'cell.audit_log'::regclass order by 1`,
      );
      const month = (offset: number) => {
        const date = new Date();
        date.setUTCDate(1);
        date.setUTCMonth(date.getUTCMonth() + offset);
        return `audit_log_y${date.getUTCFullYear()}m${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      };
      expect(rows.map((row) => row.name)).toEqual(
        expect.arrayContaining([month(0), month(1), month(2)]),
      );
    } finally {
      await admin.end();
    }
    const directory = new pg.Client({ connectionString: urls.directoryApp });
    await directory.connect();
    try {
      await expect(directory.query('select cell.ensure_audit_log_partitions()')).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await directory.end();
    }
  });
});
