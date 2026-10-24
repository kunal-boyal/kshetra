import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/**
 * The remaining standard reports of M18 (decision D86): visit compliance, coverage and frequency,
 * the location summary and the audit log. The orders register and the account statement are
 * tested with their records, in orders and finance.
 */

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

/** Connaught Place, New Delhi. */
const HERE = { lat: 28.6315, lng: 77.2167 };
const MONTH = () => todayIn('Asia/Kolkata').slice(0, 7);

function as(token: string) {
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object) => call('POST', url, payload),
    patch: (url: string, payload: object) => call('PATCH', url, payload),
  };
}
type Api = ReturnType<typeof as>;

const fix = (at: number) => ({
  location: HERE,
  accuracy: 15,
  mocked: false,
  capturedAt: new Date(at).toISOString(),
});

const report = (api: Api, key: string, query = '') =>
  api.get(`/v1/reports/${key}?period=${MONTH()}${query}`);

/** A tenant with its admin, a manager, and Asha on her phone looking after two shops. */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { admin: newPhone(), manager: newPhone(), asha: newPhone() };
  const admin = await world.user(tenantId, {
    name: 'Anita Rao',
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
    name: 'Asha Verma',
    phone: phones.asha,
    designation: 'executive',
    managerId: manager.id,
  });
  const api = {
    admin: as((await world.signIn(phones.admin)).accessToken),
    manager: as((await world.signIn(phones.manager)).accessToken),
    asha: as((await world.signIn(phones.asha, newDevice())).accessToken),
  };
  const territoryId = await world.territory(tenantId, `T-${newId().slice(-6)}`);
  const shop = async (name: string) => {
    const id = newId();
    const made = await api.admin.post('/v1/accounts', {
      id,
      type: 'customer',
      code: `C-${newId().slice(-8)}`,
      name,
      territoryId,
      location: HERE,
      slots: { executive: asha.id },
    });
    expect(made.statusCode, made.body).toBe(201);
    return id;
  };
  return {
    tenantId,
    admin,
    asha,
    api,
    visited: await shop('Sharma Stores'),
    skipped: await shop('Gupta Traders'),
  };
}

describe('the remaining standard reports (M18)', () => {
  it('shows visit compliance, coverage and frequency, and the location summary', async () => {
    const t = await tenant('Reports Co');
    const today = todayIn('Asia/Kolkata');
    const plan = async (accountId: string) => {
      const id = newId();
      const planned = await t.api.manager.post('/v1/plan-items', {
        id,
        userId: t.asha.id,
        accountId,
        date: today,
        purpose: 'Collect payment',
      });
      expect(planned.statusCode, planned.body).toBe(201);
      return id;
    };
    const visitPlan = await plan(t.visited);
    await plan(t.skipped);
    const started = Date.now() - 10 * 60_000;
    const shift = await t.api.asha.post('/v1/shifts', {
      id: newId(),
      startedAt: new Date(started).toISOString(),
      location: HERE,
      accuracy: 15,
      mocked: false,
      consentVersion: '2026-10',
    });
    expect(shift.statusCode).toBe(201);
    const visitId = newId();
    const checkedIn = await t.api.asha.post('/v1/visits', {
      id: visitId,
      accountId: t.visited,
      planItemId: visitPlan,
      checkedInAt: new Date().toISOString(),
      fix: fix(Date.now()),
    });
    expect(checkedIn.statusCode, checkedIn.body).toBe(201);
    const out = await t.api.asha.post(`/v1/visits/${visitId}/check-out`, {
      checkedOutAt: new Date().toISOString(),
      fix: fix(Date.now()),
    });
    expect(out.statusCode, out.body).toBe(200);

    const complianceReply = await report(t.api.manager, 'visit_compliance');
    expect(complianceReply.statusCode, complianceReply.body).toBe(200);
    const compliance = complianceReply.json();
    expect(compliance.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: today,
          user_name: 'Asha Verma',
          account_name: 'Sharma Stores',
          account_type: 'Customer',
          purpose: 'Collect payment',
          planned_by: 'By hand',
          plan_status: 'Visited',
        }),
        expect.objectContaining({ account_name: 'Gupta Traders', plan_status: 'Planned' }),
      ]),
    );
    expect(compliance.rows).toHaveLength(2);

    const coverage = (await report(t.api.manager, 'coverage_frequency')).json();
    expect(coverage.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_name: 'Asha Verma',
          account_name: 'Sharma Stores',
          visits: 1,
          last_visit: today,
          covered: true,
        }),
        expect.objectContaining({
          account_name: 'Gupta Traders',
          visits: 0,
          last_visit: null,
          covered: false,
        }),
      ]),
    );
    // An account type that isn't theirs leaves nothing.
    expect(
      (await report(t.api.manager, 'coverage_frequency', '&accountType=nothing')).json().rows,
    ).toEqual([]);

    const locations = (await report(t.api.manager, 'location_summary')).json();
    expect(locations.rows).toEqual([
      expect.objectContaining({
        started_at: new Date(started).toISOString(),
        ended_at: null,
        user_name: 'Asha Verma',
        pauses: 0,
        end_reason: null,
      }),
    ]);
    expect(locations.columns.map((column: { key: string }) => column.key)).toContain('gaps');
  });

  it('shows the audit log only to those who may view it', async () => {
    const t = await tenant('Audit Report Co');
    expect(
      (await t.api.admin.patch('/v1/settings', { planNotificationTime: '07:30' })).statusCode,
    ).toBe(200);
    const audit = (await report(t.api.admin, 'audit_log')).json();
    expect(audit.rows).toContainEqual(
      expect.objectContaining({ actor_name: 'Anita Rao', action: 'settings.updated' }),
    );
    // A manager reads reports but not the audit log.
    const refused = await report(t.api.manager, 'audit_log');
    expect(refused.json().error.code).toBe('FORBIDDEN');
  });
});
