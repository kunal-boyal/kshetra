import { generateKeyPairSync } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { DataExportsService } from '../src/modules/governance/data-exports.service';
import {
  ARCHIVE_SECRET_COLUMNS,
  ARCHIVE_SKIPPED_TABLES,
} from '../src/modules/governance/tenant-archive';
import { MediaService } from '../src/modules/media/media.service';
import { ArchiveInvalid, verifyArchive } from '../src/platform/archive-signer';
import { Database } from '../src/platform/database';
import { ObjectStore, type MemoryObjectStore } from '../src/platform/object-store';
import { newAddress, newDevice, newPhone, startApp, World } from './support';

/**
 * The tenant's data export (module M21, decision D95): a signed ZIP of every table and file the
 * tenant holds, and nothing of anyone else's, with secrets left out, kept for seven days.
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

function call(method: 'GET' | 'POST', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

async function organisation(name: string) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  const admin = await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  return { tenantId, admin, token: (await world.signIn(phone)).accessToken };
}

/** The archive behind a download link, read from the in-memory store as a browser would. */
async function downloaded(url: string): Promise<Uint8Array> {
  return app.get(ObjectStore).get(new URL(url).pathname.slice(1));
}

describe('tenant data export (M21, D95)', () => {
  it('writes a signed archive of the tenant’s tables and files, and nothing of another’s', async () => {
    const a = await organisation('Archive Alpha');
    const b = await organisation('Archive Bravo');
    const rep = await world.user(a.tenantId, { name: 'Asha Rao', designation: 'executive' });
    await call('POST', '/v1/api-clients', a.token, {
      id: newId(),
      name: 'ERP',
      scopes: ['people:read'],
    });
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const stored = await app.get(Database).forTenant(a.tenantId, (tx) =>
      app.get(MediaService).store(tx, a.tenantId, {
        kind: 'attachment',
        fileName: 'shop-front.jpg',
        contentType: 'image/jpeg',
        bytes: photo,
        userId: rep.id,
        ownerType: 'test',
        ownerId: null,
        retentionClass: 'attachment',
      }),
    );

    const id = newId();
    const asked = await call('POST', '/v1/data-exports', a.token, { id });
    expect(asked.statusCode, asked.body).toBe(201);
    expect(asked.json()).toMatchObject({ id, status: 'queued', download: null });
    // The same request again answers the same export; another while one is prepared is refused.
    expect((await call('POST', '/v1/data-exports', a.token, { id })).json().id).toBe(id);
    expect(
      (await call('POST', '/v1/data-exports', a.token, { id: newId() })).json().error.code,
    ).toBe('CONFLICT');

    await app.get(DataExportsService).run(a.tenantId, id);
    const ready = (await call('GET', `/v1/data-exports/${id}`, a.token)).json();
    expect(ready).toMatchObject({ status: 'ready', fileName: expect.stringMatching(/\.zip$/) });
    expect(ready.download.url).toBeTruthy();
    // Saved, never opened in the browser, under its own name (decision D101).
    expect(
      (app.get(ObjectStore) as MemoryObjectStore).disposition(
        new URL(ready.download.url).pathname.slice(1),
      ),
    ).toBe(`attachment; filename="${ready.fileName}"; filename*=UTF-8''${ready.fileName}`);
    expect(new Date(ready.download.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      23 * 3_600_000,
    );
    // The list never hands out links.
    expect((await call('GET', '/v1/data-exports', a.token)).json().items[0].download).toBeNull();

    const key = (await call('GET', '/v1/data-exports/signing-key', a.token)).json();
    expect(key).toMatchObject({ algorithm: 'Ed25519', keyId: ready.keyId });
    const bytes = await downloaded(ready.download.url);
    expect(bytes.byteLength).toBe(ready.bytes);
    const manifest = verifyArchive(bytes, key.publicKey);
    expect(manifest.tenant).toEqual({ id: a.tenantId, name: 'Archive Alpha' });
    expect(manifest.omitted.tables).toContain('idempotency_keys');
    expect(manifest.omitted.columns).toContain('api_clients.secret_hash');
    expect(manifest.tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['users', 'roles', 'audit_log', 'location_points', 'api_clients']),
    );
    expect(manifest.tables.map((table) => table.name)).not.toContain('outbox_events');
    expect(ready.tables).toBe(manifest.tables.length);

    const entries = unzipSync(bytes);
    const users = strFromU8(entries['tables/users.jsonl']!)
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(users.map((user) => user.id)).toEqual(expect.arrayContaining([a.admin.id, rep.id]));
    expect(users.every((user) => user.tenant_id === a.tenantId)).toBe(true);
    for (const table of manifest.tables) {
      expect(strFromU8(entries[table.path]!), table.name).not.toContain(b.tenantId);
    }
    const clients = strFromU8(entries['tables/api_clients.jsonl']!);
    expect(clients).toContain('"name": "ERP"');
    expect(clients).not.toContain('secret_hash');

    const file = manifest.media.find((item) => item.id === stored.id);
    expect(file).toMatchObject({ fileName: 'shop-front.jpg', bytes: photo.byteLength });
    expect(entries[file!.path]).toEqual(photo);
    // Exports aren't archived again, the archive itself included.
    expect(manifest.media.map((item) => item.kind)).not.toContain('tenant_export');

    // Anyone can tell the archive was changed, added to, or signed by another key.
    const changed = { ...entries, 'tables/users.jsonl': strToU8('{"id":"someone else"}\n') };
    expect(() => verifyArchive(zipSync(changed), key.publicKey)).toThrow(
      new ArchiveInvalid('tables/users.jsonl was changed.'),
    );
    const added = { ...entries, 'notes.txt': strToU8('hello') };
    expect(() => verifyArchive(zipSync(added), key.publicKey)).toThrow(/not in the manifest/);
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
    expect(() => verifyArchive(bytes, other.toString())).toThrow(/signature does not match/);

    const audit = (await call('GET', `/v1/audit?targetId=${id}`, a.token))
      .json()
      .items.map((entry: { action: string }) => entry.action);
    expect(audit.sort()).toEqual(['data_export.created', 'data_export.downloaded']);
  });

  it('leaves out every column that holds a secret', async () => {
    const org = await organisation('Archive Secrets');
    const found = await app.get(Database).forTenant(org.tenantId, (tx) =>
      tx.execute(sql`
        select table_name as "table", column_name as "column"
          from information_schema.columns
         where table_schema = 'cell'
           and column_name ~ '(secret|sealed|token|password|key_hash)'`),
    );
    const unguarded = (found.rows as { table: string; column: string }[]).filter(
      ({ table, column }) =>
        !ARCHIVE_SKIPPED_TABLES.includes(table) && !ARCHIVE_SECRET_COLUMNS[table]?.includes(column),
    );
    expect(found.rows.length).toBeGreaterThanOrEqual(4);
    expect(unguarded).toEqual([]);
  });

  it('keeps an archive seven days, and is for admins alone', async () => {
    const org = await organisation('Archive Keep');
    const id = newId();
    await call('POST', '/v1/data-exports', org.token, { id });
    const service = app.get(DataExportsService);
    await service.run(org.tenantId, id);
    const ready = (await call('GET', `/v1/data-exports/${id}`, org.token)).json();

    await service.expire(org.tenantId, new Date(Date.now() + 8 * 86_400_000));
    const expired = (await call('GET', `/v1/data-exports/${id}`, org.token)).json();
    expect(expired).toMatchObject({ status: 'expired', download: null });
    await expect(downloaded(ready.download.url)).rejects.toThrow();
    // Once the last is done, another may be asked for.
    expect((await call('POST', '/v1/data-exports', org.token, { id: newId() })).statusCode).toBe(
      201,
    );

    const phone = newPhone();
    await world.user(org.tenantId, { phone, designation: 'executive' });
    const rep = (await world.signIn(phone, newDevice())).accessToken;
    expect((await call('GET', '/v1/data-exports', rep)).json().error.code).toBe('FORBIDDEN');
  });
});
