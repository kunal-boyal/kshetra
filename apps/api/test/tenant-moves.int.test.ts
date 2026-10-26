import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantArchive } from '../src/modules/governance/tenant-archive';
import { TenantMoves } from '../src/modules/governance/tenant-moves';
import { MediaService } from '../src/modules/media/media.service';
import { ArchiveSigner } from '../src/platform/archive-signer';
import { Database } from '../src/platform/database';
import { ObjectStore } from '../src/platform/object-store';
import { newAddress, newDevice, newPhone, startApp, testConfig, World } from './support';

/**
 * Moving a tenant between cells (module M21, decision D95): two API processes on one database
 * stand in for two cells. The source's rows are taken out before the import, as a separate
 * database would never have held them.
 */

let source: NestFastifyApplication;
let target: NestFastifyApplication;
let world: World;
let folder: string;

beforeAll(async () => {
  source = await startApp();
  target = await startApp(testConfig({ CELL_ID: 'cell-b', CELL_API_URL: 'https://cell-b.test' }));
  world = await World.create(source);
  folder = await mkdtemp(join(tmpdir(), 'tenant-move-'));
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
  await world.end();
  await target.close();
  await source.close();
});

function call(
  app: NestFastifyApplication,
  method: 'GET' | 'POST',
  url: string,
  token: string,
  body?: object,
) {
  return app.inject({
    method,
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

const count = async (app: NestFastifyApplication, tenantId: string, table: string) =>
  app.get(Database).forTenant(tenantId, async (tx) => {
    const result = await tx.execute(
      sql.raw(`select count(*)::int as n from cell."${table}" where tenant_id = '${tenantId}'`),
    );
    return (result.rows[0] as { n: number }).n;
  });

describe('moving a tenant between cells (M21, D95)', () => {
  it('freezes, exports, imports with every count, switches, and sends phones a full copy', async () => {
    const tenantId = await world.tenant('Moving Traders');
    const head = await world.user(tenantId, {
      name: 'Anita Rao',
      designation: 'head',
      role: 'tenant_admin',
    });
    const phone = newPhone();
    const rep = await world.user(tenantId, {
      phone,
      name: 'Ravi Shah',
      designation: 'executive',
      managerId: head.id,
    });
    const session = await world.signIn(phone, newDevice());
    const cursor = (
      await call(source, 'GET', '/v1/sync/pull?entities=users', session.accessToken)
    ).json().cursor;
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const stored = await source.get(Database).forTenant(tenantId, (tx) =>
      source.get(MediaService).store(tx, tenantId, {
        kind: 'attachment',
        fileName: 'shop.jpg',
        contentType: 'image/jpeg',
        bytes: photo,
        userId: rep.id,
        ownerType: 'test',
        ownerId: null,
        retentionClass: 'attachment',
      }),
    );
    const sourceMoves = source.get(TenantMoves);
    const targetMoves = target.get(TenantMoves);

    // The target lists itself; the move starts, and the tenant only reads.
    await targetMoves.registerCell();
    await expect(sourceMoves.export(tenantId, join(folder, 'early.zip'))).rejects.toThrow(
      /Start the move first/,
    );
    await sourceMoves.start(tenantId, 'cell-b');
    await expect(sourceMoves.start(tenantId, 'cell-b')).rejects.toThrow(/being moved already/);
    expect((await call(source, 'GET', '/v1/me', session.accessToken)).statusCode).toBe(200);
    const frozen = await call(source, 'POST', '/v1/notifications/read', session.accessToken, {
      all: true,
    });
    expect(frozen.json().error.code).toBe('TENANT_MOVING');

    const path = join(folder, 'move.zip');
    const facts = await sourceMoves.export(tenantId, path);
    expect(facts.files).toBe(1);
    const archive = await readFile(path);
    const publicKey = source.get(ArchiveSigner).publicKeyPem;

    // The source can't take it back, nor can a cell it isn't going to.
    await expect(sourceMoves.import(archive, publicKey)).rejects.toThrow(
      /not being moved to this cell/,
    );
    // A tenant's own export isn't a move archive.
    const ownPath = join(folder, 'own.zip');
    await source
      .get(Database)
      .forTenant(tenantId, (tx) =>
        source.get(TenantArchive).write(tx, tenantId, ownPath, 'export'),
      );
    await expect(targetMoves.import(await readFile(ownPath), publicKey)).rejects.toThrow(
      /only a move archive is imported/,
    );

    const before = {
      users: await count(source, tenantId, 'users'),
      audit_log: await count(source, tenantId, 'audit_log'),
      media: await count(source, tenantId, 'media'),
    };
    // A separate database would never have held the tenant: take its rows out here.
    await source
      .get(Database)
      .forTenant(tenantId, (tx) => tx.execute(sql`select cell.purge_tenant(${tenantId})`));
    expect(await count(source, tenantId, 'users')).toBe(0);

    await expect(targetMoves.import(archive, 'not a key')).rejects.toThrow();
    const report = await targetMoves.import(archive, publicKey);
    expect(report).toMatchObject({ tenantId, files: 1 });
    expect(await count(target, tenantId, 'users')).toBe(before.users);
    expect(await count(target, tenantId, 'audit_log')).toBe(before.audit_log);
    expect(await count(target, tenantId, 'media')).toBe(before.media);
    // References within a table land too, and the file is in the new cell's store.
    const manager = await target.get(Database).forTenant(tenantId, async (tx) => {
      const result = await tx.execute(
        sql`select manager_id from cell.users where tenant_id = ${tenantId} and id = ${rep.id}`,
      );
      return (result.rows[0] as { manager_id: string }).manager_id;
    });
    expect(manager).toBe(head.id);
    const key = `t/${tenantId}/attachment/${stored.id}`;
    expect(await target.get(ObjectStore).get(key)).toEqual(photo);
    // Importing twice is refused.
    await expect(targetMoves.import(archive, publicKey)).rejects.toThrow(
      /holds rows of the tenant/,
    );

    await targetMoves.finish(tenantId);
    // The old cell sends people on; a refresh names the new cell.
    expect((await call(source, 'GET', '/v1/me', session.accessToken)).json().error.code).toBe(
      'TENANT_MOVED',
    );
    // Each test process signs tokens with a key of its own; in a deployment the one directory does.
    const refreshed = (
      await target.inject({
        method: 'POST',
        url: '/auth/v1/token/refresh',
        remoteAddress: newAddress(),
        payload: { refreshToken: session.refreshToken },
      })
    ).json();
    expect(refreshed.tenant.cellUrl).toBe('https://cell-b.test');
    const token = refreshed.session.accessToken;
    const landed = await call(target, 'GET', '/v1/me', token);
    expect(landed.statusCode, landed.body).toBe(200);
    const written = await call(target, 'POST', '/v1/notifications/read', token, { all: true });
    expect(written.statusCode, written.body).toBeLessThan(300);
    // A phone's cursor from the old cell starts a full copy.
    const pulled = await call(
      target,
      'GET',
      `/v1/sync/pull?entities=users&cursor=${cursor}`,
      token,
    );
    expect(pulled.json().error.code).toBe('SYNC_RESET');

    // The new cell won't purge a tenant that lives on it.
    await expect(targetMoves.purge(tenantId, { files: false })).rejects.toThrow(
      /still lives on this cell/,
    );
  });

  it('calls a move off, and the tenant writes again', async () => {
    const tenantId = await world.tenant('Staying Traders');
    const phone = newPhone();
    await world.user(tenantId, { phone, designation: 'executive' });
    const session = await world.signIn(phone, newDevice());
    const moves = source.get(TenantMoves);
    await target.get(TenantMoves).registerCell();
    await moves.start(tenantId, 'cell-b');
    await moves.cancel(tenantId);
    await expect(moves.cancel(tenantId)).rejects.toThrow(/not being moved/);
    const written = await call(source, 'POST', '/v1/notifications/read', session.accessToken, {
      all: true,
    });
    expect(written.statusCode, written.body).toBeLessThan(300);
    await expect(moves.start(tenantId, 'nowhere')).rejects.toThrow(/no cell nowhere/);
  });
});
