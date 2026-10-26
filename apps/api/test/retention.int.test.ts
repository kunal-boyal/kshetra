import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationDeliveries, notifications } from '../src/db/schema/notifications';
import { RecordRetention } from '../src/modules/governance/record-retention';
import { AuditLog } from '../src/platform/audit';
import { Database } from '../src/platform/database';
import { ObjectStore } from '../src/platform/object-store';
import { newAddress, newPhone, startApp, World } from './support';

/**
 * Retention for what the tenant chooses how long to keep (BR-41, decision D95): notifications,
 * uploaded import files and the audit log, removed each night past the tenant's settings, each
 * run in the audit log.
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

const DAY = 86_400_000;

function call(method: 'GET' | 'PATCH', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

async function notification(tenantId: string, userId: string, daysAgo: number): Promise<string> {
  const id = newId();
  await app.get(Database).forTenant(tenantId, async (tx) => {
    await tx.insert(notifications).values({
      id,
      tenantId,
      userId,
      event: 'plan.today',
      category: 'plan',
      values: { count: 3 },
      dedupeKey: `test:${id}`,
      createdAt: new Date(Date.now() - daysAgo * DAY),
    });
    await tx.insert(notificationDeliveries).values({
      id: newId(),
      tenantId,
      notificationId: id,
      channel: 'push',
      status: 'sent',
      createdAt: new Date(Date.now() - daysAgo * DAY),
    });
  });
  return id;
}

async function count(tenantId: string, query: string): Promise<number> {
  return app.get(Database).forTenant(tenantId, async (tx) => {
    const result = await tx.execute(sql.raw(query.replace('$tenant', `'${tenantId}'`)));
    return (result.rows[0] as { n: number }).n;
  });
}

describe('record retention (BR-41, D95)', () => {
  it('removes notifications, import files and audit entries past the tenant’s keeping times', async () => {
    const tenantId = await world.tenant('Keeping Traders');
    const phone = newPhone();
    const admin = await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
    const token = (await world.signIn(phone)).accessToken;

    const old = await notification(tenantId, admin.id, 100);
    const recent = await notification(tenantId, admin.id, 10);

    const uploaded = await app.inject({
      method: 'POST',
      url: '/v1/imports?target=users&fileName=people.csv',
      remoteAddress: newAddress(),
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': newId(),
        'content-type': 'text/csv',
      },
      payload: 'Employee code,Name\nK-1,Asha Rao',
    });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const importId = uploaded.json().id;
    const fileKey = await app.get(Database).forTenant(tenantId, async (tx) => {
      await tx.execute(
        sql`update cell.import_jobs set created_at = now() - interval '40 days' where tenant_id = ${tenantId} and id = ${importId}`,
      );
      const result = await tx.execute(
        sql`select m.object_key from cell.import_jobs j join cell.media m on m.tenant_id = j.tenant_id and m.id = j.file_media_id where j.tenant_id = ${tenantId} and j.id = ${importId}`,
      );
      return (result.rows[0] as { object_key: string }).object_key;
    });

    // An audit entry four years old, in a month made for it, and one from today.
    const oldEntry = newId();
    await app.get(Database).forTenant(tenantId, async (tx) => {
      await tx.execute(
        sql`select cell.ensure_month_partitions('audit_log', now() - interval '4 years', now() - interval '4 years')`,
      );
      await tx.execute(
        sql`insert into cell.audit_log (id, tenant_id, actor_kind, action, target_type, created_at)
            values (${oldEntry}, ${tenantId}, 'system', 'organisation.renamed', 'organisation', now() - interval '4 years')`,
      );
    });

    // Kept for a year, the old notification would stay.
    const kept = await call('PATCH', '/v1/settings', token, { notificationRetentionDays: 365 });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(await app.get(RecordRetention).apply(tenantId)).toEqual({
      notifications: 0,
      importFiles: 1,
      audit: 1,
    });
    await call('PATCH', '/v1/settings', token, { notificationRetentionDays: 90 });

    const removed = await app.get(RecordRetention).apply(tenantId);
    expect(removed).toEqual({ notifications: 1, importFiles: 0, audit: 0 });
    expect(
      await count(
        tenantId,
        `select count(*)::int as n from cell.notifications where tenant_id = $tenant and id = '${old}'`,
      ),
    ).toBe(0);
    expect(
      await count(
        tenantId,
        `select count(*)::int as n from cell.notifications where tenant_id = $tenant and id = '${recent}'`,
      ),
    ).toBe(1);
    await expect(app.get(ObjectStore).get(fileKey)).rejects.toThrow();
    const job = (await call('GET', `/v1/imports/${importId}`, token)).json();
    expect(job.id).toBe(importId);
    expect(
      await count(
        tenantId,
        `select count(*)::int as n from cell.audit_log where tenant_id = $tenant and id = '${oldEntry}'`,
      ),
    ).toBe(0);
    const runs = await app.get(Database).forTenant(tenantId, async (tx) => {
      const result = await tx.execute(
        sql`select "after"->>'class' as class from cell.audit_log where tenant_id = ${tenantId} and action = 'retention.applied'`,
      );
      return (result.rows as { class: string }[]).map((row) => row.class).sort();
    });
    expect(runs).toEqual(['audit', 'importFiles', 'notifications']);

    // A second run the same night finds nothing more.
    expect(await app.get(RecordRetention).apply(tenantId)).toEqual({
      notifications: 0,
      importFiles: 0,
      audit: 0,
    });
  });

  it('keeps the audit log a year at least, whatever asks', async () => {
    const tenantId = await world.tenant('Careful Traders');
    await expect(
      app
        .get(Database)
        .forTenant(tenantId, (tx) =>
          app.get(AuditLog).purgeBefore(tx, tenantId, new Date(Date.now() - 180 * DAY)),
        ),
    ).rejects.toThrow();
    const out = await call(
      'PATCH',
      '/v1/settings',
      (await world.signIn(await adminPhone(tenantId))).accessToken,
      {
        auditRetentionYears: 0,
      },
    );
    expect(out.json().error.details).toContainEqual(
      expect.objectContaining({ path: 'auditRetentionYears' }),
    );
  });
});

async function adminPhone(tenantId: string): Promise<string> {
  const phone = newPhone();
  await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  return phone;
}
