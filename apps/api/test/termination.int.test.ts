import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantTermination } from '../src/modules/console/tenant-termination';
import { DirectoryDatabase } from '../src/modules/directory/directory.database';
import { DataExportsService } from '../src/modules/governance/data-exports.service';
import { SYSTEM } from '../src/modules/iam/actor';
import { UsersService } from '../src/modules/iam/users.service';
import { MediaService } from '../src/modules/media/media.service';
import { Database } from '../src/platform/database';
import { ObjectStore } from '../src/platform/object-store';
import { newAddress, newPhone, staffToken, startApp, World } from './support';

/**
 * Terminating a tenant (module M22, decision D95): from suspended only, with its slug repeated; a
 * final export at once, linked for the customer; undone within 30 days; then every row and file
 * erased, its people's memberships and sessions removed, and a certificate in the platform audit.
 */

let app: NestFastifyApplication;
let world: World;
let admin: string;

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
  admin = await staffToken(app, 'platform_admin');
});

afterAll(async () => {
  await world.end();
  await app.close();
});

function console_(method: 'GET' | 'POST', url: string, token = admin, body?: object) {
  return app.inject({
    method,
    url: `/platform/v1${url}`,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}` },
    ...(body ? { payload: body } : {}),
  });
}

async function slugOf(tenantId: string): Promise<string> {
  return (await console_('GET', `/tenants/${tenantId}`)).json().slug;
}

const cellRows = (tenantId: string) =>
  app.get(Database).forTenant(tenantId, async (tx) => {
    const result = await tx.execute(
      sql`select count(*)::int as n from cell.users where tenant_id = ${tenantId}`,
    );
    return (result.rows[0] as { n: number }).n;
  });

async function directoryCount(table: string, column: string, value: string): Promise<number> {
  const result = await app
    .get(DirectoryDatabase)
    .db.execute(
      sql.raw(`select count(*)::int as n from directory.${table} where ${column} = '${value}'`),
    );
  return (result.rows[0] as { n: number }).n;
}

describe('terminating a tenant (M22, D95)', () => {
  it('terminates a suspended tenant after its slug, with a final export to send', async () => {
    const tenantId = await world.tenant('Closing Traders');
    await world.user(tenantId, { designation: 'head', role: 'tenant_admin' });
    const slug = await slugOf(tenantId);

    expect(
      (
        await console_('POST', `/tenants/${tenantId}/terminate`, admin, {
          reason: 'Contract ended',
          confirmSlug: slug,
        })
      ).json().error.code,
    ).toBe('CONFLICT');
    await console_('POST', `/tenants/${tenantId}/suspend`, admin, { reason: 'Contract ended' });
    const wrong = await console_('POST', `/tenants/${tenantId}/terminate`, admin, {
      reason: 'Contract ended',
      confirmSlug: 'someone-else',
    });
    expect(wrong.json().error.details).toEqual([
      { path: 'confirmSlug', issue: `Type the tenant's slug, ${slug}` },
    ]);
    const support = await staffToken(app, 'support');
    expect(
      (
        await console_('POST', `/tenants/${tenantId}/terminate`, support, {
          reason: 'Contract ended',
          confirmSlug: slug,
        })
      ).statusCode,
    ).toBe(403);

    const terminated = await console_('POST', `/tenants/${tenantId}/terminate`, admin, {
      reason: 'Contract ended',
      confirmSlug: slug,
    });
    expect(terminated.statusCode, terminated.body).toBe(200);
    const tenant = terminated.json();
    expect(tenant).toMatchObject({ status: 'terminated', deletedAt: null });
    expect(new Date(tenant.deletesAt).getTime() - new Date(tenant.terminatedAt).getTime()).toBe(
      30 * 86_400_000,
    );

    // The final export, asked for at once by the staff member, ready to link for the customer.
    const [final] = (await console_('GET', `/tenants/${tenantId}/data-exports`)).json().items;
    expect(final).toMatchObject({
      status: 'queued',
      requestedBy: { id: null, name: 'Staff platform_admin' },
    });
    await app.get(DataExportsService).run(tenantId, final.id);
    const linked = (await console_('GET', `/tenants/${tenantId}/data-exports/${final.id}`)).json();
    expect(linked.status).toBe('ready');
    expect(linked.download.url).toBeTruthy();
    const audit = await app.get(Database).forTenant(tenantId, async (tx) => {
      const result = await tx.execute(
        sql`select action, actor_kind from cell.audit_log where tenant_id = ${tenantId} and target_id = ${final.id}`,
      );
      return result.rows as { action: string; actor_kind: string }[];
    });
    expect(audit).toEqual(
      expect.arrayContaining([
        { action: 'data_export.created', actor_kind: 'platform' },
        { action: 'data_export.downloaded', actor_kind: 'platform' },
      ]),
    );

    // Undone within the 30 days, it is suspended again; terminating again is the same request.
    const undone = await console_('POST', `/tenants/${tenantId}/undo-termination`);
    expect(undone.json()).toMatchObject({
      status: 'suspended',
      terminatedAt: null,
      deletesAt: null,
    });
    expect(
      (await console_('POST', `/tenants/${tenantId}/undo-termination`)).json().error.code,
    ).toBe('CONFLICT');
  });

  it('erases the tenant 30 days on, keeps people of other tenants, and records it', async () => {
    const closing = await world.tenant('Erased Traders');
    const staying = await world.tenant('Staying Traders');
    // Someone who left the closing tenant for the staying one (one organisation at a time, D103).
    const shared = newPhone();
    const { userIds } = await world.member(shared, [closing], { designation: 'executive' });
    await world.database.forTenant(closing, (tx) =>
      app.get(UsersService).update(tx, closing, SYSTEM, userIds[0]!, { status: 'inactive' }),
    );
    await world.user(staying, { phone: shared, designation: 'executive' });
    const alonePhone = newPhone();
    await world.user(closing, { phone: alonePhone, designation: 'head', role: 'tenant_admin' });
    const file = await app.get(Database).forTenant(closing, (tx) =>
      app.get(MediaService).store(tx, closing, {
        kind: 'attachment',
        fileName: 'shop.jpg',
        contentType: 'image/jpeg',
        bytes: new Uint8Array([1, 2, 3]),
        userId: userIds[0]!,
        ownerType: 'test',
        ownerId: null,
        retentionClass: 'attachment',
      }),
    );
    const slug = await slugOf(closing);
    await console_('POST', `/tenants/${closing}/suspend`, admin, { reason: 'Contract ended' });
    await console_('POST', `/tenants/${closing}/terminate`, admin, {
      reason: 'Contract ended',
      confirmSlug: slug,
    });

    const termination = app.get(TenantTermination);
    // Not before its 30 days.
    expect(await termination.deleteDue(new Date(Date.now() + 29 * 86_400_000))).toBe(0);
    expect(await cellRows(closing)).toBeGreaterThan(0);

    expect(await termination.deleteDue(new Date(Date.now() + 31 * 86_400_000))).toBe(1);
    expect(await cellRows(closing)).toBe(0);
    expect(await directoryCount('memberships', 'tenant_id', closing)).toBe(0);
    await expect(app.get(ObjectStore).get(`t/${closing}/attachment/${file.id}`)).rejects.toThrow();
    // The person in another tenant stays, and so does that tenant; the one who wasn't is gone.
    expect(await directoryCount('memberships', 'tenant_id', staying)).toBe(1);
    expect(await cellRows(staying)).toBe(1);
    expect(await directoryCount('identities', 'phone_e164', alonePhone)).toBe(0);
    expect(await directoryCount('identities', 'phone_e164', shared)).toBe(1);

    const tenant = (await console_('GET', `/tenants/${closing}`)).json();
    expect(tenant).toMatchObject({ status: 'terminated', deletesAt: null });
    expect(tenant.deletedAt).toBeTruthy();
    const certificate = await app
      .get(DirectoryDatabase)
      .db.execute(
        sql`select detail from directory.platform_audit where target_id = ${closing} and action = 'tenant.deleted'`,
      );
    expect((certificate.rows[0] as { detail: Record<string, unknown> }).detail).toMatchObject({
      files: 1,
      memberships: 2,
      people: 1,
      kept: expect.arrayContaining(['invoices']),
    });
    expect(
      (certificate.rows[0] as { detail: { cellRows: number } }).detail.cellRows,
    ).toBeGreaterThan(2);
    // Nothing left to do, and nothing to undo.
    expect(await termination.deleteDue(new Date(Date.now() + 32 * 86_400_000))).toBe(0);
    expect((await console_('POST', `/tenants/${closing}/undo-termination`)).json().error.code).toBe(
      'CONFLICT',
    );
  });
});
