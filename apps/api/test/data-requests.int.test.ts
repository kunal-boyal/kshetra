import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { dataRequestDueOn, newId, todayIn } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DirectoryDatabase } from '../src/modules/directory/directory.database';
import { DataRequestsService } from '../src/modules/governance/data-requests.service';
import { MediaService } from '../src/modules/media/media.service';
import { ArchiveSigner, verifyArchive } from '../src/platform/archive-signer';
import { Database } from '../src/platform/database';
import { ObjectStore } from '../src/platform/object-store';
import { Outbox } from '../src/platform/outbox';
import { newAddress, newDevice, newPhone, startApp, World } from './support';

/**
 * Personal data requests (module M21, decision D95): raised by the person on their phone or logged
 * by an admin, due 30 days on; access answered with a signed archive of their own data; erasure,
 * only once they are deactivated, anonymising them and keeping what they did.
 */

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

const HERE = { lat: 28.6315, lng: 77.2167 };

function as(token: string) {
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      remoteAddress: newAddress(),
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object) => call('POST', url, payload),
    patch: (url: string, payload: object) => call('PATCH', url, payload),
    put: (url: string, payload: object) => call('PUT', url, payload),
  };
}

async function organisation(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { admin: newPhone(), person: newPhone() };
  const admin = await world.user(tenantId, {
    phone: phones.admin,
    name: 'Anita Rao',
    designation: 'head',
    role: 'tenant_admin',
  });
  const person = await world.user(tenantId, {
    phone: phones.person,
    name: 'Ravi Shah',
    email: 'ravi@sunrise.example',
    designation: 'executive',
    managerId: admin.id,
    joiningDate: '2026-01-01',
  });
  return {
    tenantId,
    adminId: admin.id,
    person,
    personPhone: phones.person,
    admin: as((await world.signIn(phones.admin)).accessToken),
    phone: as((await world.signIn(phones.person, newDevice())).accessToken),
  };
}

const notified = (tenantId: string, userId: string, event: string) =>
  app.get(Database).forTenant(tenantId, async (tx) => {
    const result = await tx.execute(
      sql`select values from cell.notifications where tenant_id = ${tenantId} and user_id = ${userId} and event = ${event}`,
    );
    return result.rows as { values: Record<string, string> }[];
  });

describe('personal data requests (M21, D95)', () => {
  it('answers an access request with a signed archive of the person’s own data', async () => {
    const t = await organisation('Access Traders');
    const other = await world.user(t.tenantId, { name: 'Someone Else', designation: 'executive' });
    const id = newId();
    const raised = await t.phone.post('/v1/me/data-requests', {
      id,
      kind: 'access',
      details: 'Everything you hold about me',
    });
    expect(raised.statusCode, raised.body).toBe(201);
    expect(raised.json()).toMatchObject({
      status: 'received',
      raisedBy: { self: true, name: 'Ravi Shah' },
      dueOn: dataRequestDueOn(todayIn('Asia/Kolkata')),
      archive: null,
    });
    expect(await notified(t.tenantId, t.adminId, 'data_request.received')).toEqual([
      { values: { person: 'Ravi Shah', kind: 'access', due: raised.json().dueOn } },
    ]);
    // One open request of a kind at a time; a field person can't see anyone's.
    expect(
      (await t.phone.post('/v1/me/data-requests', { id: newId(), kind: 'access' })).json().error
        .details,
    ).toEqual([{ path: 'kind', issue: 'An open request of this kind exists already' }]);
    expect((await t.phone.get('/v1/data-requests')).json().error.code).toBe('FORBIDDEN');

    // Completing needs the archive first.
    expect(
      (await t.admin.post(`/v1/data-requests/${id}/close`, { outcome: 'completed' })).json().error
        .details,
    ).toEqual([{ path: 'outcome', issue: 'Prepare their archive first' }]);
    const photo = await app.get(Database).forTenant(t.tenantId, (tx) =>
      app.get(MediaService).store(tx, t.tenantId, {
        kind: 'attachment',
        fileName: 'mine.jpg',
        contentType: 'image/jpeg',
        bytes: new Uint8Array([1, 2, 3]),
        userId: t.person.id,
        ownerType: 'test',
        ownerId: null,
        retentionClass: 'attachment',
      }),
    );
    expect((await t.admin.post(`/v1/data-requests/${id}/archive`)).json().archive.status).toBe(
      'queued',
    );
    await app.get(DataRequestsService).runArchive(t.tenantId, id);
    const ready = (await t.admin.get(`/v1/data-requests/${id}`)).json();
    expect(ready.archive.status).toBe('ready');
    const bytes = await app.get(ObjectStore).get(new URL(ready.download.url).pathname.slice(1));
    const manifest = verifyArchive(bytes, app.get(ArchiveSigner).publicKeyPem);
    expect(manifest).toMatchObject({ purpose: 'personal', subject: t.person.id });
    const entries = unzipSync(bytes);
    const users = strFromU8(entries['tables/users.jsonl']!).trim().split('\n');
    expect(users.map((line) => JSON.parse(line).id)).toEqual([t.person.id]);
    for (const table of manifest.tables) {
      expect(strFromU8(entries[table.path]!), table.name).not.toContain(other.id);
    }
    expect(manifest.media.map((file) => file.id)).toEqual([photo.id]);

    const done = await t.admin.post(`/v1/data-requests/${id}/close`, {
      outcome: 'completed',
      response: 'Your archive was emailed to you',
    });
    expect(done.json()).toMatchObject({ status: 'completed', closedBy: 'Anita Rao' });
    expect(await notified(t.tenantId, t.person.id, 'data_request.closed')).toEqual([
      {
        values: {
          outcome: 'completed',
          kind: 'access',
          response: 'Your archive was emailed to you',
        },
      },
    ]);
    expect((await t.phone.get('/v1/me/data-requests')).json().items).toEqual([
      expect.objectContaining({ id, status: 'completed' }),
    ]);
  });

  it('gives the person their copy once the request is done, and only them (D141)', async () => {
    const t = await organisation('Copy Traders');
    const id = newId();
    await t.phone.post('/v1/me/data-requests', { id, kind: 'access' });
    await t.admin.post(`/v1/data-requests/${id}/archive`);
    await app.get(DataRequestsService).runArchive(t.tenantId, id);

    // Prepared but not yet answered: the person sees it is ready, with no link yet.
    const waiting = await t.phone.get(`/v1/me/data-requests/${id}`);
    expect(waiting.statusCode, waiting.body).toBe(200);
    expect(waiting.json()).toMatchObject({
      status: 'received',
      archive: { status: 'ready' },
      download: null,
    });

    await t.admin.post(`/v1/data-requests/${id}/close`, {
      outcome: 'completed',
      response: 'Download it from My data',
    });
    const done = await t.phone.get(`/v1/me/data-requests/${id}`);
    expect(done.statusCode, done.body).toBe(200);
    const copy = done.json();
    expect(copy).toMatchObject({ status: 'completed', archive: { status: 'ready' } });
    const bytes = await app.get(ObjectStore).get(new URL(copy.download.url).pathname.slice(1));
    expect(verifyArchive(bytes, app.get(ArchiveSigner).publicKeyPem).subject).toBe(t.person.id);
    // The list never carries a link.
    expect((await t.phone.get('/v1/me/data-requests')).json().items[0].download).toBeNull();

    // Reading the link is audited, as the admin's is; reading the list is not.
    const downloads = () =>
      app.get(Database).forTenant(t.tenantId, async (tx) => {
        const result = await tx.execute(
          sql`select actor_id from cell.audit_log where tenant_id = ${t.tenantId} and action = 'data_request.downloaded' and target_id = ${id}`,
        );
        return result.rows as { actor_id: string }[];
      });
    expect(await downloads()).toEqual([{ actor_id: t.person.id }]);

    // Nobody else reads it through the person's route, not even the admin; nor an API client.
    expect((await t.admin.get(`/v1/me/data-requests/${id}`)).json().error.code).toBe('NOT_FOUND');
    const colleague = newPhone();
    await world.user(t.tenantId, { phone: colleague, name: 'Mira Das', designation: 'executive' });
    const other = as((await world.signIn(colleague, newDevice())).accessToken);
    expect((await other.get(`/v1/me/data-requests/${id}`)).json().error.code).toBe('NOT_FOUND');
    const made = (
      await t.admin.post('/v1/api-clients', { id: newId(), name: 'HR', scopes: ['people:write'] })
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
    const client = as(issued.json().access_token as string);
    expect((await client.get(`/v1/me/data-requests/${id}`)).statusCode).toBe(403);
    expect(await downloads()).toHaveLength(1);

    // Seven days on, the copy is gone.
    await app.get(DataRequestsService).upkeep(t.tenantId, new Date(Date.now() + 8 * 86_400_000));
    expect((await t.phone.get(`/v1/me/data-requests/${id}`)).json()).toMatchObject({
      archive: { status: 'expired' },
      download: null,
    });
    expect(await downloads()).toHaveLength(1);
  });

  it('erases a deactivated person, keeps what they did, and forgets their sign-in', async () => {
    const t = await organisation('Erasure Traders');
    // The person works a shift, with a point on the way, before leaving.
    const shift = newId();
    const opened = await t.phone.post('/v1/shifts', {
      id: shift,
      location: HERE,
      accuracy: 15,
      mocked: false,
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      consentVersion: '2026-10',
    });
    expect(opened.statusCode, opened.body).toBe(201);
    const batch = await t.phone.post('/v1/locations/batch', {
      points: [
        {
          id: newId(),
          shiftId: shift,
          capturedAt: new Date(Date.now() - 1_800_000).toISOString(),
          location: HERE,
          accuracy: 12,
          mocked: false,
          source: 'background',
        },
      ],
    });
    expect(batch.statusCode, batch.body).toBeLessThan(300);
    // And has a monthly gross on file (M14, decision D117).
    const gross = await t.admin.put(`/v1/payroll-gross/${t.person.id}`, { monthlyGross: '30000' });
    expect(gross.statusCode, gross.body).toBe(200);

    const id = newId();
    const logged = await t.admin.post('/v1/data-requests', {
      id,
      userId: t.person.id,
      kind: 'erasure',
      details: 'Asked by letter after leaving',
    });
    expect(logged.json()).toMatchObject({ raisedBy: { self: false, name: 'Anita Rao' } });
    expect(
      (await t.admin.post(`/v1/data-requests/${id}/close`, { outcome: 'completed' })).json().error
        .details,
    ).toEqual([{ path: 'outcome', issue: 'Deactivate them before erasing their data' }]);

    await t.admin.patch(`/v1/users/${t.person.id}`, { status: 'inactive' });
    const erased = await t.admin.post(`/v1/data-requests/${id}/close`, {
      outcome: 'completed',
      response: 'Erased',
    });
    expect(erased.statusCode, erased.body).toBe(200);
    // Deliver the erasure event, as the relay would, for the directory to forget them.
    await app.get(Database).forTenant(t.tenantId, async (tx) => {
      const pending = await tx.execute(
        sql`select id from cell.outbox_events where tenant_id = ${t.tenantId} and dispatched_at is null`,
      );
      for (const row of pending.rows as { id: string }[]) {
        await app.get(Outbox).deliver(t.tenantId, row.id);
      }
    });

    const after = await app.get(Database).forTenant(t.tenantId, async (tx) => {
      const user = await tx.execute(
        sql`select name, code, phone_e164, email from cell.users where tenant_id = ${t.tenantId} and id = ${t.person.id}`,
      );
      const points = await tx.execute(
        sql`select count(*)::int as n from cell.location_points where tenant_id = ${t.tenantId} and user_id = ${t.person.id}`,
      );
      const shifts = await tx.execute(
        sql`select count(*)::int as n from cell.shifts where tenant_id = ${t.tenantId} and user_id = ${t.person.id}`,
      );
      const gross = await tx.execute(
        sql`select count(*)::int as n from cell.payroll_gross where tenant_id = ${t.tenantId} and user_id = ${t.person.id}`,
      );
      return {
        user: user.rows[0] as Record<string, string | null>,
        points: (points.rows[0] as { n: number }).n,
        shifts: (shifts.rows[0] as { n: number }).n,
        gross: (gross.rows[0] as { n: number }).n,
      };
    });
    expect(after.user).toEqual({
      name: `Former employee ${t.person.code}`,
      code: t.person.code,
      phone_e164: null,
      email: null,
    });
    expect(after.points).toBe(0);
    expect(after.shifts).toBe(1);
    expect(after.gross).toBe(0);
    const identities = await app
      .get(DirectoryDatabase)
      .db.execute(
        sql`select count(*)::int as n from directory.identities where phone_e164 = ${t.personPhone}`,
      );
    expect((identities.rows[0] as { n: number }).n).toBe(0);
    // Nobody tells someone erased; their own notifications are gone.
    expect(await notified(t.tenantId, t.person.id, 'data_request.closed')).toEqual([]);
  });

  it('refuses with a reason, and reminds the admins a week before a request is due', async () => {
    const t = await organisation('Careful Traders');
    const id = newId();
    await t.phone.post('/v1/me/data-requests', { id, kind: 'correction', details: 'My name' });
    expect(
      (await t.admin.post(`/v1/data-requests/${id}/close`, { outcome: 'refused' })).json().error
        .details,
    ).toEqual([{ path: 'response', issue: 'Say why it is refused' }]);

    const service = app.get(DataRequestsService);
    await service.upkeep(t.tenantId, new Date(Date.now() + 10 * 86_400_000));
    expect(await notified(t.tenantId, t.adminId, 'data_request.due_soon')).toEqual([]);
    await service.upkeep(t.tenantId, new Date(Date.now() + 24 * 86_400_000));
    await service.upkeep(t.tenantId, new Date(Date.now() + 25 * 86_400_000));
    expect(await notified(t.tenantId, t.adminId, 'data_request.due_soon')).toHaveLength(1);

    const refused = await t.admin.post(`/v1/data-requests/${id}/close`, {
      outcome: 'refused',
      response: 'Your name is already correct',
    });
    expect(refused.json().status).toBe('refused');
    expect((await t.admin.get('/v1/data-requests?status=closed')).json().items).toEqual([
      expect.objectContaining({ id, status: 'refused' }),
    ]);
  });
});
