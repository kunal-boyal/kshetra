import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId, todayIn } from '@thelamp/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ApprovalsService } from '../src/modules/workflow/approvals.service';
import { Database } from '../src/platform/database';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/**
 * Approval chains (spec 5.9, M15, BR-31, decision D74), through the one request type every tenant
 * can turn on: a month's plan (journey_plan).
 */

const urls = inject('databaseUrls');
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

const H = 3_600_000;
const HERE = { lat: 28.6315, lng: 77.2167 };
const TODAY = () => todayIn('Asia/Kolkata');

function nextMonth(): string {
  const [year, month] = TODAY().split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const admin = new pg.Client({ connectionString: urls.admin });
  await admin.connect();
  try {
    return (await admin.query<T>(text, values)).rows;
  } finally {
    await admin.end();
  }
}

function as(token: string) {
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object) =>
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
    put: (url: string, payload: object) => call('PUT', url, payload),
  };
}

/**
 * A tenant whose head is its admin, a manager reporting to the head, Asha reporting to the
 * manager and Ravi reporting to the head, each with a shop and plans that need approval.
 */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { head: newPhone(), manager: newPhone(), asha: newPhone(), ravi: newPhone() };
  const head = await world.user(tenantId, {
    phone: phones.head,
    designation: 'head',
    role: 'tenant_admin',
  });
  const manager = await world.user(tenantId, {
    phone: phones.manager,
    designation: 'manager',
    role: 'manager',
    managerId: head.id,
  });
  const asha = await world.user(tenantId, {
    phone: phones.asha,
    designation: 'executive',
    managerId: manager.id,
  });
  const ravi = await world.user(tenantId, {
    phone: phones.ravi,
    designation: 'executive',
    managerId: head.id,
  });
  const api = {
    head: as((await world.signIn(phones.head)).accessToken),
    manager: as((await world.signIn(phones.manager)).accessToken),
    asha: as((await world.signIn(phones.asha, newDevice())).accessToken),
    ravi: as((await world.signIn(phones.ravi, newDevice())).accessToken),
  };
  expect((await api.head.patch('/v1/settings', { journeyPlanApproval: true })).statusCode).toBe(
    200,
  );
  const territoryId = await world.territory(tenantId, `T-${newId().slice(-6)}`);
  const shops = new Map<string, string>();
  for (const [person, holder] of [
    ['asha', asha.id],
    ['ravi', ravi.id],
  ] as const) {
    const id = newId();
    const made = await api.head.post('/v1/accounts', {
      id,
      type: 'customer',
      code: `C-${newId().slice(-8)}`,
      name: `${person} shop`,
      territoryId,
      location: HERE,
      slots: { executive: holder },
    });
    expect(made.statusCode).toBe(201);
    shops.set(person, id);
  }
  /** Plans a visit next month for a person and sends the month for approval. */
  const submit = async (person: 'asha' | 'ravi') => {
    const period = nextMonth();
    const userId = person === 'asha' ? asha.id : ravi.id;
    const planned = await api.head.post('/v1/plan-items', {
      id: newId(),
      userId,
      accountId: shops.get(person),
      date: `${period}-15`,
      purpose: 'Collect payment',
    });
    expect(planned.statusCode).toBe(201);
    const sent = await api[person].post('/v1/plans/submit', { userId, period });
    expect(sent.statusCode).toBe(200);
    return sent.json().approvalId as string;
  };
  const chain = async (steps: object[]) => {
    const current = (await api.head.get('/v1/workflows'))
      .json()
      .chains.find((entry: { requestType: string }) => entry.requestType === 'journey_plan');
    const saved = await api.head.put('/v1/workflows/journey_plan', {
      steps,
      version: current.version,
    });
    expect(saved.statusCode).toBe(200);
    return saved.json();
  };
  return { tenantId, head, manager, asha, ravi, api, submit, chain };
}

const MANAGER_THEN_HEAD = [
  { approver: { type: 'reporting_manager', level: 1 } },
  { approver: { type: 'nearest_designation', designation: 'head' } },
];

describe('approval chains (spec 5.9, BR-31)', () => {
  it('lists a chain per request type and versions every change, refusing a stale edit', async () => {
    const t = await tenant('Chains Co');
    const before = (await t.api.head.get('/v1/workflows')).json();
    expect(before.chains).toHaveLength(8);
    expect(before.fallbackRole).toBe('business_head');
    const first = await t.chain(MANAGER_THEN_HEAD);
    expect(first).toMatchObject({ requestType: 'journey_plan', version: 1 });
    const stale = await t.api.head.put('/v1/workflows/journey_plan', {
      steps: MANAGER_THEN_HEAD,
      version: 0,
    });
    expect(stale.json().error.code).toBe('CONFLICT');
    const wrong = await t.api.head.put('/v1/workflows/journey_plan', {
      steps: [
        { approver: { type: 'nearest_designation', designation: 'captain' } },
        { approver: { type: 'account_slot', slot: 'executive' } },
      ],
      version: 1,
    });
    expect(wrong.json().error.details).toEqual([
      { path: 'steps[0].approver.designation', issue: 'There is no designation `captain`' },
      {
        path: 'steps[1].approver',
        issue: 'A `journey_plan` request has no account to take a slot from',
      },
    ]);
    expect((await t.api.manager.get('/v1/workflows')).statusCode).toBe(403);
  });

  it('FX-23: skips the manager step when the manager is the head', async () => {
    const t = await tenant('Head Co');
    await t.chain(MANAGER_THEN_HEAD);
    const id = await t.submit('ravi');
    const request = (await t.api.ravi.get(`/v1/approvals/${id}`)).json();
    expect(request.steps.map((step: { status: string }) => step.status)).toEqual([
      'skipped',
      'pending',
    ]);
    expect(request.steps[0].skipReason).toBe('repeated');
    expect(request.steps[1].approvers.map((p: { id: string }) => p.id)).toEqual([t.head.id]);
  });

  it('FX-24: waits at each step in turn, and only its approvers act', async () => {
    const t = await tenant('Steps Co');
    await t.chain(MANAGER_THEN_HEAD);
    const id = await t.submit('asha');
    let request = (await t.api.asha.get(`/v1/approvals/${id}`)).json();
    expect(request.steps.map((step: { status: string }) => step.status)).toEqual([
      'pending',
      'waiting',
    ]);
    expect((await t.api.head.get('/v1/approvals/inbox')).json().items).toEqual([]);
    const early = await t.api.head.post(`/v1/approvals/${id}/decision`, {
      decision: 'approve',
      version: request.version,
    });
    expect(early.json().error.code).toBe('NOT_CURRENT_APPROVER');

    const first = await t.api.manager.post(`/v1/approvals/${id}/decision`, {
      decision: 'approve',
      version: request.version,
    });
    expect(first.json()).toMatchObject({ status: 'pending', cancellable: false });
    request = first.json();
    expect(request.steps.map((step: { status: string }) => step.status)).toEqual([
      'approved',
      'pending',
    ]);
    // The manager's approval doesn't settle the month yet.
    const plan = () =>
      t.api.asha
        .get(`/v1/plan-items?userId=${t.asha.id}&period=${nextMonth()}`)
        .then((r) => r.json().approval.status);
    expect(await plan()).toBe('submitted');
    const [waiting] = (await t.api.head.get('/v1/approvals/inbox')).json().items;
    expect(waiting.id).toBe(id);
    const last = await t.api.head.post(`/v1/approvals/${id}/decision`, {
      decision: 'approve',
      version: request.version,
    });
    expect(last.json().status).toBe('approved');
    expect(await plan()).toBe('approved');
  });

  it('ends at the first rejection, which needs a reason', async () => {
    const t = await tenant('Reject Co');
    await t.chain(MANAGER_THEN_HEAD);
    const id = await t.submit('asha');
    const { version } = (await t.api.asha.get(`/v1/approvals/${id}`)).json();
    const bare = await t.api.manager.post(`/v1/approvals/${id}/decision`, {
      decision: 'reject',
      version,
    });
    expect(bare.statusCode).toBe(400);
    const rejected = await t.api.manager.post(`/v1/approvals/${id}/decision`, {
      decision: 'reject',
      note: 'Plan the Monday market too',
      version,
    });
    expect(rejected.json()).toMatchObject({ status: 'rejected' });
    expect(rejected.json().steps[1].status).toBe('waiting');
  });

  it('lets the requester withdraw a request until someone decides a step', async () => {
    const t = await tenant('Cancel Co');
    await t.chain(MANAGER_THEN_HEAD);
    const id = await t.submit('asha');
    expect((await t.api.manager.post(`/v1/approvals/${id}/cancel`)).json().error.code).toBe(
      'FORBIDDEN',
    );
    const withdrawn = await t.api.asha.post(`/v1/approvals/${id}/cancel`);
    expect(withdrawn.json()).toMatchObject({ status: 'cancelled', cancellable: false });
    expect((await t.api.manager.get('/v1/approvals/inbox')).json().items).toEqual([]);

    const again = await t.submit('asha');
    const { version } = (await t.api.asha.get(`/v1/approvals/${again}`)).json();
    await t.api.manager.post(`/v1/approvals/${again}/decision`, { decision: 'approve', version });
    expect((await t.api.asha.post(`/v1/approvals/${again}/cancel`)).json().error.code).toBe(
      'CONFLICT',
    );
  });

  it('counts the inbox by type, approves many at once, and lists what each person asked for', async () => {
    const t = await tenant('Bulk Co');
    await t.chain([{ approver: { type: 'nearest_designation', designation: 'head' } }]);
    const first = await t.submit('asha');
    const second = await t.submit('ravi');
    const inbox = (await t.api.head.get('/v1/approvals/inbox')).json();
    expect(inbox.counts).toEqual({ journey_plan: 2 });
    expect(inbox.items.every((item: { bulk: boolean }) => item.bulk)).toBe(true);
    const versions = new Map<string, number>(
      inbox.items.map((item: { id: string; version: number }) => [item.id, item.version]),
    );

    const bulk = await t.api.head.post('/v1/approvals/decisions', {
      items: [
        { id: first, version: versions.get(first) },
        { id: second, version: versions.get(second)! + 1 },
      ],
    });
    expect(bulk.statusCode, bulk.body).toBe(200);
    const [done, stale] = bulk.json().results;
    expect(done).toMatchObject({ id: first, error: null, approval: { status: 'approved' } });
    expect(stale).toMatchObject({ id: second, approval: null, error: { code: 'CONFLICT' } });
    expect((await t.api.head.get('/v1/approvals/inbox')).json().counts).toEqual({
      journey_plan: 1,
    });

    // Nobody approves in bulk what they could not approve one at a time.
    const outsider = await t.api.manager.post('/v1/approvals/decisions', {
      items: [{ id: second, version: versions.get(second) }],
    });
    expect(outsider.json().results[0].error.code).toBe('NOT_CURRENT_APPROVER');

    const mine = (await t.api.asha.get('/v1/approvals/mine')).json();
    expect(mine.items.map((item: { id: string }) => item.id)).toEqual([first]);
    expect(mine.items[0]).toMatchObject({ status: 'approved', cancellable: false });
    const waiting = (await t.api.ravi.get('/v1/approvals/mine?status=pending')).json();
    expect(waiting.items.map((item: { id: string }) => item.id)).toEqual([second]);
    expect((await t.api.ravi.get('/v1/approvals/mine?status=approved')).json().items).toEqual([]);
  });

  it('goes to the fallback role when no step remains, and escalates a step nobody can take', async () => {
    const t = await tenant('Fallback Co');
    await t.chain([{ approver: { type: 'nearest_designation', designation: 'manager' } }]);
    // Ravi has no manager-level ancestor, so the head decides as the fallback approver.
    expect(
      (await t.api.head.put('/v1/workflows/fallback', { role: 'tenant_admin' })).statusCode,
    ).toBe(200);
    const id = await t.submit('ravi');
    const request = (await t.api.ravi.get(`/v1/approvals/${id}`)).json();
    expect(request.steps).toEqual([
      expect.objectContaining({ status: 'skipped', skipReason: 'no_approver' }),
      expect.objectContaining({ status: 'pending', fallback: true }),
    ]);
    expect(request.steps[1].approvers.map((p: { id: string }) => p.id)).toEqual([t.head.id]);
  });

  it('reminds once, then escalates a step left waiting, to the role that reaches the requester', async () => {
    const t = await tenant('Sla Co');
    await t.chain([
      {
        approver: { type: 'reporting_manager', level: 1 },
        reminderAfterHours: 24,
        escalation: { afterHours: 48, to: 'tenant_admin' },
      },
    ]);
    const id = await t.submit('asha');
    const approvals = app.get(ApprovalsService);
    const database = app.get(Database);
    const keep = (hours: number) =>
      database.forTenant(t.tenantId, (tx) =>
        approvals.keepTime(tx, t.tenantId, new Date(Date.now() + hours * H)),
      );
    expect(await keep(1)).toBe(0);
    expect(await keep(25)).toBe(1);
    expect(await keep(26)).toBe(0);
    const reminded = await sql<{ reminded_at: Date | null }>(
      'select reminded_at from cell.workflow_steps where tenant_id = $1 and instance_id = $2',
      [t.tenantId, id],
    );
    expect(reminded[0]!.reminded_at).not.toBeNull();
    expect(await keep(49)).toBe(1);
    const request = (await t.api.asha.get(`/v1/approvals/${id}`)).json();
    expect(request.steps[0]).toMatchObject({ status: 'pending', escalated: true });
    expect(request.steps[0].approvers.map((p: { id: string }) => p.id).sort()).toEqual(
      [t.manager.id, t.head.id].sort(),
    );
    const events = await sql<{ type: string; payload: { reason: string } }>(
      `select type, payload from cell.outbox_events where tenant_id = $1 and type = 'approval.waiting'
        order by created_at`,
      [t.tenantId],
    );
    expect(events.map((event) => event.payload.reason)).toEqual(['reminder', 'escalated']);
    expect(await keep(100)).toBe(0);
  });
});
