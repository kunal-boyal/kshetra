import { MetricDefinition } from '@thelamp/metrics';
import { newId, rankCutoff, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { metricFactsDaily, scoreDefinitions, scoreSnapshots } from '../src/db/schema';
import { MetricsService } from '../src/modules/metrics/metrics.service';
import { MetricsEngine } from '../src/modules/performance/metrics-engine';
import { PerformanceUpkeep } from '../src/modules/performance/performance.upkeep';
import { Database } from '../src/platform/database';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** The metric engine, scores, ranks and leaderboards (M9, spec 12.5, BR-02 to BR-07). */

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
const MONTH = todayIn('Asia/Kolkata').slice(0, 7);
/** The last day counted for last week's rank, or null early in the month. */
const CUTOFF = rankCutoff(MONTH, todayIn('Asia/Kolkata'));
const text = (en: string) => ({ en, hi: en });
const noun = (one: string) => ({ en: { one, other: `${one}s` }, hi: { one, other: one } });

function as(token: string) {
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object) => call('POST', url, payload),
    put: (url: string, payload: object) => call('PUT', url, payload),
  };
}

type Api = ReturnType<typeof as>;

const METRICS = [
  { key: 'calls', unit: 'count', source: { type: 'submission_count', forms: ['call'] } },
  {
    key: 'amount',
    unit: 'currency',
    source: { type: 'submission_field_sum', forms: ['call'], field: 'amount' },
  },
  {
    key: 'shops',
    unit: 'count',
    source: { type: 'distinct_accounts_visited', forms: ['call'], accountTypes: ['customer'] },
  },
  {
    key: 'reach',
    unit: 'percent',
    source: { type: 'coverage_percent', forms: ['call'], accountTypes: ['customer'] },
  },
  { key: 'days', unit: 'count', source: { type: 'active_days', forms: ['call'] } },
  {
    key: 'per_call',
    unit: 'currency',
    source: { type: 'ratio', numerator: 'amount', denominator: 'calls' },
  },
].map((metric) => MetricDefinition.parse({ ...metric, name: noun(metric.key) }));

/**
 * A tenant with its admin, a manager with Asha reporting to them, and Ravi reporting to the admin;
 * Asha looks after two shops and Ravi one; a reviewed `call` form and the metrics above, scored on
 * calls and amount.
 */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { admin: newPhone(), manager: newPhone(), asha: newPhone(), ravi: newPhone() };
  const admin = await world.user(tenantId, {
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
    phone: phones.asha,
    designation: 'executive',
    managerId: manager.id,
  });
  const ravi = await world.user(tenantId, {
    phone: phones.ravi,
    designation: 'executive',
    managerId: admin.id,
  });
  const api = {
    admin: as((await world.signIn(phones.admin)).accessToken),
    manager: as((await world.signIn(phones.manager)).accessToken),
    asha: as((await world.signIn(phones.asha, newDevice())).accessToken),
    ravi: as((await world.signIn(phones.ravi, newDevice())).accessToken),
  };
  const made = await api.admin.post('/v1/forms', {
    definition: {
      key: 'call',
      name: noun('Call'),
      icon: 'notebook-pen',
      review: 'manual',
      accountLink: { mode: 'optional', accountTypes: ['customer'] },
      fields: [{ key: 'amount', type: 'currency', label: text('Amount') }],
    },
  });
  expect(made.statusCode).toBe(201);
  const territoryId = await world.territory(tenantId, `T-${newId().slice(-6)}`);
  const shop = async (holder: string) => {
    const id = newId();
    const reply = await api.admin.post('/v1/accounts', {
      id,
      type: 'customer',
      code: `C-${newId().slice(-8)}`,
      name: `Shop ${id.slice(-4)}`,
      territoryId,
      slots: { executive: holder },
    });
    expect(reply.statusCode).toBe(201);
    return id;
  };
  const shops = [await shop(asha.id), await shop(asha.id), await shop(ravi.id)] as const;
  const database = app.get(Database);
  await database.forTenant(tenantId, async (tx) => {
    await app.get(MetricsService).applyTemplate(tx, tenantId, METRICS);
    await tx
      .update(scoreDefinitions)
      .set({
        definition: {
          periodType: 'month',
          cap: 1,
          rankingGroupBy: 'designation',
          metrics: [
            { metric: 'calls', weight: 50 },
            { metric: 'amount', weight: 50 },
          ],
        },
      })
      .where(eq(scoreDefinitions.tenantId, tenantId));
  });
  for (const who of [api.asha, api.ravi]) {
    const shift = await who.post('/v1/shifts', {
      id: newId(),
      startedAt: new Date(Date.now() - 2 * H).toISOString(),
      location: HERE,
      accuracy: 15,
      mocked: false,
      consentVersion: '2026-10',
    });
    expect(shift.statusCode).toBe(201);
  }
  return { tenantId, admin, manager, asha, ravi, api, shops, territoryId };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

/** A `call` at a shop; returns the submission's ID. */
async function call(api: Api, accountId: string, amount: string) {
  const id = newId();
  const sent = await api.post('/v1/submissions', {
    id,
    form: { key: 'call', version: 1 },
    accountId,
    capturedAt: new Date().toISOString(),
    fix: { location: HERE, accuracy: 12, mocked: false, capturedAt: new Date().toISOString() },
    values: { amount },
  });
  expect(sent.statusCode).toBe(201);
  return id;
}

async function review(api: Api, id: string, decision: 'approved' | 'rejected', note?: string) {
  const reply = await api.post(`/v1/submissions/${id}/review`, {
    decision,
    ...(note ? { note } : {}),
  });
  expect(reply.statusCode).toBe(200);
}

const figures = async (api: Api, userId?: string) =>
  (await api.get(`/v1/performance?period=${MONTH}${userId ? `&userId=${userId}` : ''}`)).json();

async function work(t: Tenant) {
  const [ashas1, ashas2, ravis] = t.shops;
  const first = await call(t.api.asha, ashas1, '100');
  const second = await call(t.api.asha, ashas2, '50.50');
  await call(t.api.asha, ashas1, '25');
  const third = await call(t.api.ravi, ravis, '400');
  await review(t.api.manager, first, 'approved');
  await review(t.api.manager, second, 'approved');
  await review(t.api.admin, third, 'approved');
  return { first, second, third };
}

async function lockTargets(t: Tenant) {
  const put = async (api: Api, userId: string, values: object) => {
    const reply = await api.put('/v1/targets', {
      period: MONTH,
      sets: [{ userId, values, version: 0 }],
    });
    expect(reply.statusCode).toBe(200);
    const locked = await api.post('/v1/targets/lock', { period: MONTH, userIds: [userId] });
    expect(locked.json().locked).toEqual([userId]);
  };
  await put(t.api.manager, t.asha.id, { calls: '4', amount: '301' });
  await put(t.api.admin, t.ravi.id, { calls: '1', amount: '400' });
}

describe('the metric engine (spec 12.5)', () => {
  it('counts approved work, pending apart, distinct shops, coverage and ratios (BR-02 to BR-05)', async () => {
    const t = await tenant('Engine Co');
    const { second } = await work(t);
    const mine = await figures(t.api.asha);
    expect(mine.figures).toMatchObject({
      calls: { actual: '2', pending: '1', target: null, attainment: null },
      amount: { actual: '150.5', pending: '25' },
      shops: { actual: '2' },
      reach: { actual: '100' },
      days: { actual: '1' },
      per_call: { actual: '75.25' },
    });
    // Orders are a source now (decision D78); this person placed none.
    expect(mine.metrics.find((m: { key: string }) => m.key === 'order_value')).toMatchObject({
      available: true,
    });
    expect(mine.figures.order_value).toMatchObject({ actual: '0' });
    expect(mine.days).toEqual([
      {
        date: expect.any(String),
        values: expect.objectContaining({ calls: '2', amount: '150.5' }),
      },
    ]);

    // A rejection takes the work back out.
    await review(t.api.manager, second, 'rejected', 'No such shop visit');
    const after = (await figures(t.api.asha)).figures;
    expect(after).toMatchObject({
      calls: { actual: '1' },
      amount: { actual: '100' },
      shops: { actual: '1' },
      reach: { actual: '50' },
    });

    // Recomputing a day again changes nothing.
    const today = todayIn('Asia/Kolkata');
    const database = app.get(Database);
    const facts = () =>
      database.forTenant(t.tenantId, (tx) =>
        tx
          .select()
          .from(metricFactsDaily)
          .where(
            and(eq(metricFactsDaily.tenantId, t.tenantId), eq(metricFactsDaily.userId, t.asha.id)),
          ),
      );
    const without = (rows: Awaited<ReturnType<typeof facts>>) =>
      rows.map((row) => ({ ...row, computedAt: null }));
    const before = without(await facts());
    await database.forTenant(t.tenantId, (tx) =>
      app.get(MetricsEngine).recompute(tx, t.tenantId, t.asha.id, today),
    );
    expect(without(await facts())).toEqual(before);
  });
});

describe('scores and ranks (BR-06, BR-07)', () => {
  it('scores locked targets, ranks within the designation, and shows the team its totals', async () => {
    const t = await tenant('Score Co');
    await work(t);
    expect(await figures(t.api.asha)).toMatchObject({
      locked: false,
      score: null,
      rank: null,
      group: { key: 'executive', size: 2 },
    });
    await lockTargets(t);

    const asha = await figures(t.api.asha);
    expect(asha).toMatchObject({ locked: true, score: 50, rank: 2 });
    expect(asha.figures.calls).toMatchObject({ actual: '2', target: '4', attainment: 0.5 });
    expect(await figures(t.api.ravi)).toMatchObject({ score: 100, rank: 1 });

    await world.attach(t.tenantId, t.asha.id, t.territoryId);
    const board = (await t.api.asha.get(`/v1/leaderboard?period=${MONTH}`)).json();
    expect(board).toMatchObject({ group: 'executive', groups: [{ key: 'executive', size: 2 }] });
    expect(board.metrics.map((metric: { key: string }) => metric.key)).toContain('calls');
    // All the work is today's, so at the end of last week both stood level on nothing.
    const before = CUTOFF === null ? null : 1;
    expect(board.rows).toEqual([
      expect.objectContaining({
        user: expect.objectContaining({ id: t.ravi.id }),
        territory: null,
        score: 100,
        rank: 1,
        previousRank: before,
        you: false,
      }),
      expect.objectContaining({
        user: expect.objectContaining({ id: t.asha.id }),
        territory: { code: expect.stringMatching(/^T-/), name: expect.any(String) },
        score: 50,
        rank: 2,
        previousRank: before,
        you: true,
      }),
    ]);
    expect(board.rows[1].figures.calls).toMatchObject({ actual: '2', target: '4' });
    expect(
      (await t.api.asha.get(`/v1/leaderboard?period=${MONTH}&group=manager`)).json().error.code,
    ).toBe('NOT_FOUND');

    const team = (await t.api.manager.get(`/v1/performance/team?period=${MONTH}`)).json();
    expect(team.rows.map((row: { user: { id: string } }) => row.user.id)).toEqual([t.asha.id]);
    expect(team.rows[0]).toMatchObject({
      score: 50,
      rank: 2,
      previousRank: before,
      territory: { code: expect.stringMatching(/^T-/) },
    });
    const all = (await t.api.admin.get(`/v1/performance/team?period=${MONTH}`)).json();
    expect(all.totals).toMatchObject({
      calls: { actual: '3', pending: '1', target: '5' },
      amount: { actual: '550.5', target: '701' },
      shops: { actual: '3' },
      reach: { actual: '100' },
      per_call: { actual: '183.5' },
    });

    // Snapshots keep the month's standing.
    await app.get(PerformanceUpkeep).nightly(t.tenantId);
    const kept = await app
      .get(Database)
      .forTenant(t.tenantId, (tx) =>
        tx.select().from(scoreSnapshots).where(eq(scoreSnapshots.tenantId, t.tenantId)),
      );
    expect(
      kept
        .filter((row) => row.period === MONTH)
        .map(({ userId, score, rank }) => ({ userId, score, rank }))
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
    ).toEqual([
      { userId: t.ravi.id, score: 100, rank: 1 },
      { userId: t.asha.id, score: 50, rank: 2 },
    ]);
  });

  it.skipIf(CUTOFF === null)('ranks the month up to last Sunday for the movement', async () => {
    const t = await tenant('Movement Co');
    await work(t);
    await lockTargets(t);
    // A call of Asha's counted on last week's last day: she led then, and Ravi has climbed since.
    await app.get(Database).forTenant(t.tenantId, (tx) =>
      tx.insert(metricFactsDaily).values({
        tenantId: t.tenantId,
        userId: t.asha.id,
        date: CUTOFF!,
        metricKey: 'calls',
        value: '1',
      }),
    );
    const board = (await t.api.ravi.get(`/v1/leaderboard?period=${MONTH}`)).json();
    expect(
      board.rows.map((row: { user: { id: string } }) => [row.user.id, row.rank, row.previousRank]),
    ).toEqual([
      [t.ravi.id, 1, 2],
      [t.asha.id, 2, 1],
    ]);
  });

  it("shows another person's month only to those who see their team's, in scope", async () => {
    const t = await tenant('Scope Co');
    expect((await figures(t.api.manager, t.asha.id)).user.id).toBe(t.asha.id);
    expect((await figures(t.api.manager, t.ravi.id)).error.code).toBe('OUT_OF_SCOPE');
    expect((await figures(t.api.asha, t.ravi.id)).error.code).toBe('FORBIDDEN');
    expect((await figures(t.api.manager, newId())).error.code).toBe('NOT_FOUND');
    expect((await t.api.asha.get(`/v1/performance/team?period=${MONTH}`)).json().error.code).toBe(
      'FORBIDDEN',
    );
  });
});
