import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId, todayIn } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAddress, newPhone, startApp, World } from './support';

/**
 * The audit viewer (module M21, decision D95): the log filtered by month, action and who acted,
 * with people and API clients named; and its export, which for the whole organisation holds what
 * the system, vendor staff and API clients changed too, with the values before and after.
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

function call(method: 'GET' | 'POST' | 'PATCH', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

const month = () => todayIn('Asia/Kolkata').slice(0, 7);

describe('the audit viewer (M21, D95)', () => {
  it('filters by month, action and who acted, and names people and API clients', async () => {
    const tenantId = await world.tenant('Watched Traders');
    const phone = newPhone();
    const admin = await world.user(tenantId, {
      phone,
      name: 'Anita Rao',
      designation: 'head',
      role: 'tenant_admin',
    });
    const token = (await world.signIn(phone)).accessToken;
    expect(
      (await call('PATCH', '/v1/settings', token, { planNotificationTime: '07:30' })).statusCode,
    ).toBe(200);
    const made = (
      await call('POST', '/v1/api-clients', token, {
        id: newId(),
        name: 'Tally ERP',
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
    const code = `W${newId().slice(-6)}`;
    const asha = await call('POST', '/v1/users', client, {
      code,
      name: 'Asha Verma',
      designation: 'executive',
    });
    expect(asha.statusCode).toBe(201);

    const settings = (
      await call('GET', `/v1/audit?period=${month()}&action=settings.updated`, token)
    ).json();
    expect(settings.items).toEqual([
      expect.objectContaining({
        action: 'settings.updated',
        actor: { kind: 'user', id: admin.id, name: `Anita Rao (${admin.code})` },
        // Only people and API clients are named as targets.
        target: expect.objectContaining({ label: null }),
      }),
    ]);
    const byClient = (await call('GET', `/v1/audit?actorKind=api_client`, token)).json();
    expect(byClient.items).toEqual([
      expect.objectContaining({
        action: 'user.created',
        actor: { kind: 'api_client', id: made.client.id, name: 'Tally ERP' },
        target: { type: 'user', id: asha.json().id, label: `Asha Verma (${code})` },
      }),
    ]);
    // Provisioning wrote its own entries, as the system.
    const bySystem = (await call('GET', `/v1/audit?actorKind=system`, token)).json();
    expect(bySystem.items.length).toBeGreaterThan(0);
    expect(
      bySystem.items.every((item: { actor: { kind: string } }) => item.actor.kind === 'system'),
    ).toBe(true);
    expect((await call('GET', '/v1/audit?period=2001-01', token)).json().items).toEqual([]);

    // The report for the whole organisation holds every kind of actor, with the changes.
    const report = (
      await call('GET', `/v1/reports/audit_log?period=${month()}&limit=200`, token)
    ).json();
    expect(report.columns.map((column: { key: string }) => column.key)).toEqual(
      expect.arrayContaining(['actor_kind', 'changes']),
    );
    const kinds = new Set(report.rows.map((row: { actor_kind: string }) => row.actor_kind));
    expect([...kinds]).toEqual(expect.arrayContaining(['A person', 'The system', 'An API client']));
    expect(report.rows).toContainEqual(
      expect.objectContaining({ actor_name: 'Tally ERP', action: 'user.created' }),
    );
    const settingsRow = report.rows.find(
      (row: { action: string }) => row.action === 'settings.updated',
    );
    expect(JSON.parse(settingsRow.changes)).toMatchObject({
      after: expect.objectContaining({ planNotificationTime: '07:30' }),
    });
    // Narrowed by action and by who acted, as the viewer's export asks.
    const narrowed = (
      await call(
        'GET',
        `/v1/reports/audit_log?period=${month()}&auditActorKind=api_client&auditAction=user.created`,
        token,
      )
    ).json();
    expect(narrowed.rows.map((row: { actor_name: string }) => row.actor_name)).toEqual([
      'Tally ERP',
    ]);
    // One person narrows it to them alone.
    const mine = (
      await call(
        'GET',
        `/v1/reports/audit_log?period=${month()}&userId=${admin.id}&limit=200`,
        token,
      )
    ).json();
    expect(mine.rows.every((row: { actor_kind: string }) => row.actor_kind === 'A person')).toBe(
      true,
    );

    const exported = await call('POST', '/v1/exports', token, {
      id: newId(),
      report: 'audit_log',
      filters: { period: month(), auditActorKind: 'api_client' },
      format: 'csv',
    });
    expect(exported.statusCode, exported.body).toBe(201);
  });
});
