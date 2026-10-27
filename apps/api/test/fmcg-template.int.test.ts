import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId, todayIn } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/**
 * The FMCG template (spec A.4, decision D97) on a tenant: an outlet visit asks why there was no
 * order only when the visit took none; productive calls and productivity follow the orders taken
 * in visits; and a new outlet a DSR proposes counts once the SO approves it.
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

const MINUTE = 60_000;
const HERE = { lat: 20.0059, lng: 73.791 };
const MONTH = todayIn('Asia/Kolkata').slice(0, 7);

function as(token: string) {
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object) => call('POST', url, payload),
  };
}

const fix = (at: number) => ({
  location: HERE,
  accuracy: 12,
  mocked: false,
  capturedAt: new Date(at).toISOString(),
});

describe('the FMCG template (spec A.4, decision D97)', () => {
  it('asks why there was no order, counts productive calls, and counts approved new outlets', async () => {
    const tenantId = await world.tenant('Ujjwal Consumer', 'active', 'fmcg');
    const phones = { admin: newPhone(), so: newPhone(), dsr: newPhone() };
    const admin = await world.user(tenantId, {
      phone: phones.admin,
      designation: 'business_head',
      role: 'tenant_admin',
    });
    const so = await world.user(tenantId, {
      phone: phones.so,
      designation: 'so',
      role: 'manager',
      managerId: admin.id,
    });
    const dsr = await world.user(tenantId, {
      phone: phones.dsr,
      designation: 'dsr',
      role: 'field_user',
      managerId: so.id,
    });
    const api = {
      admin: as((await world.signIn(phones.admin)).accessToken),
      so: as((await world.signIn(phones.so)).accessToken),
      dsr: as((await world.signIn(phones.dsr, newDevice())).accessToken),
    };
    const territoryId = await world.territory(tenantId, `F-${newId().slice(-6)}`);
    const account = async (body: object) => {
      const id = newId();
      const reply = await api.admin.post('/v1/accounts', {
        id,
        territoryId,
        location: HERE,
        ...body,
      });
      expect(reply.statusCode, reply.body).toBe(201);
      return id;
    };
    const distributor = await account({
      type: 'distributor',
      code: `DB-${newId().slice(-6)}`,
      name: 'Patil Distributors',
      slots: { so: so.id },
    });
    const outlet = (name: string) =>
      account({
        type: 'outlet',
        name,
        parentId: distributor,
        slots: { dsr: dsr.id, so: so.id },
        custom: { channel: 'grocery' },
      });
    const kirana = await outlet('More Kirana Stores');
    const general = await outlet('Nashik General Stores');

    const opened = await api.dsr.post('/v1/shifts', {
      id: newId(),
      startedAt: new Date(Date.now() - 3 * 60 * MINUTE).toISOString(),
      location: HERE,
      accuracy: 12,
      mocked: false,
      consentVersion: '2026-10',
    });
    expect(opened.statusCode, opened.body).toBe(201);
    const shiftId = opened.json().id as string;

    /** An outlet visit `minutesAgo` before now; an order goes in first when `ordered`. */
    const visit = async (
      accountId: string,
      minutesAgo: number,
      values: object,
      ordered = false,
    ) => {
      const start = Date.now() - minutesAgo * MINUTE;
      const visitId = newId();
      const checkedIn = await api.dsr.post('/v1/visits', {
        id: visitId,
        accountId,
        checkedInAt: new Date(start).toISOString(),
        fix: fix(start),
      });
      expect(checkedIn.statusCode, checkedIn.body).toBe(201);
      if (ordered) {
        await world.database.forTenant(tenantId, (tx) =>
          tx.execute(sql`
            insert into cell.orders (id, number, tenant_id, account_id, supplier_kind, user_id, visit_id, shift_id,
                                     placed_at, subtotal, tax_total, total)
            values (${newId()}, (select coalesce(max(number), 1000) + 1 from cell.orders where tenant_id = ${tenantId}), ${tenantId}, ${accountId}, 'company', ${dsr.id}, ${visitId}, ${shiftId},
                    ${new Date(start + 2 * MINUTE).toISOString()}, '0.00', '0.00', '0.00')`),
        );
      }
      const sent = await api.dsr.post('/v1/submissions', {
        id: newId(),
        form: { key: 'outlet_visit', version: 1 },
        visitId,
        capturedAt: new Date(start + 5 * MINUTE).toISOString(),
        fix: fix(start + 5 * MINUTE),
        values,
        photos: [],
      });
      const out = await api.dsr.post(`/v1/visits/${visitId}/check-out`, {
        checkedOutAt: new Date(start + 10 * MINUTE).toISOString(),
        fix: fix(start + 10 * MINUTE),
      });
      expect(out.statusCode, out.body).toBe(200);
      return sent;
    };

    // No order: the reason is needed. An order taken: nobody asks, and a reason isn't kept.
    expect((await visit(kirana, 150, { visibility_ok: true })).json().error.details).toEqual([
      { path: 'values.no_order_reason', issue: 'Fill this in' },
    ]);
    const unordered = await visit(kirana, 130, { no_order_reason: 'enough_stock' });
    expect(unordered.statusCode, unordered.body).toBe(201);
    const ordered = await visit(general, 110, { no_order_reason: 'owner_away' }, true);
    expect(ordered.statusCode, ordered.body).toBe(201);
    expect(ordered.json().values).toEqual({});

    // A new outlet the DSR proposes waits for the SO; it counts once approved.
    const proposed = newId();
    const proposal = await api.dsr.post('/v1/accounts', {
      id: proposed,
      type: 'outlet',
      name: 'Om Sai Provision Stores',
      territoryId,
      parentId: distributor,
      location: HERE,
      custom: { channel: 'cosmetics' },
    });
    expect(proposal.statusCode, proposal.body).toBe(201);
    expect(proposal.json().status).toBe('pending');
    const before = (await api.dsr.get(`/v1/performance?period=${MONTH}`)).json();
    expect(before.figures.new_outlets).toMatchObject({ actual: '0', pending: '1' });

    const inbox = (await api.so.get('/v1/approvals/inbox')).json();
    const request = inbox.items.find(
      (item: { requestType: string; requestId: string }) =>
        item.requestType === 'new_account' && item.requestId === proposed,
    );
    expect(request).toBeDefined();
    const decided = await api.so.post(`/v1/approvals/${request.id}/decision`, {
      decision: 'approve',
      version: request.version,
    });
    expect(decided.statusCode, decided.body).toBe(200);

    const queue = (await api.so.get('/v1/reviews/queue?status=pending')).json();
    for (const entry of queue.items) {
      const reviewed = await api.so.post(`/v1/submissions/${entry.id}/review`, {
        decision: 'approved',
      });
      expect(reviewed.statusCode, reviewed.body).toBe(200);
    }
    const after = (await api.dsr.get(`/v1/performance?period=${MONTH}`)).json();
    expect(after.figures).toMatchObject({
      total_calls: { actual: '2' },
      productive_calls: { actual: '1' },
      productivity: { actual: '50' },
      new_outlets: { actual: '1' },
    });
  });
});
