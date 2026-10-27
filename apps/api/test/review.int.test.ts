import { newId } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReviewService } from '../src/modules/review/review.service';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Evidence review (M7): the queue, decisions, bulk approval and auto-approval. */

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

function as(token: string, deviceTime?: string) {
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object, key = newId()) =>
    app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': key,
        ...(deviceTime ? { 'x-device-time': deviceTime } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object, key?: string) => call('POST', url, payload, key),
    put: (url: string, payload: object) => call('PUT', url, payload),
  };
}

type Api = ReturnType<typeof as>;

const noun = (word: string) => ({
  en: { one: word, other: `${word}s` },
  hi: { one: word, other: word },
});

/**
 * A tenant with its admin on the web, a manager on a phone with Asha reporting to them, and Ravi
 * reporting to the admin; two forms of its own, one reviewed by a person and one automatically.
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
  const ashasPhone = newDevice();
  const api = {
    admin: as((await world.signIn(phones.admin)).accessToken),
    manager: as((await world.signIn(phones.manager, newDevice())).accessToken),
    asha: as((await world.signIn(phones.asha, ashasPhone)).accessToken),
    ravi: as((await world.signIn(phones.ravi, newDevice())).accessToken),
  };
  for (const [key, review] of [
    ['note', 'manual'],
    ['quick_note', 'auto'],
  ] as const) {
    const made = await api.admin.post('/v1/forms', {
      definition: {
        key,
        name: noun(key),
        icon: 'notebook-pen',
        review,
        fields: [{ key: 'text', type: 'short_text', label: { en: 'Text', hi: 'Text' } }],
      },
    });
    expect(made.statusCode).toBe(201);
  }
  for (const who of [api.asha, api.ravi, api.manager]) {
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
  return {
    tenantId,
    admin,
    manager,
    asha,
    ravi,
    api,
    ashasPhone,
    /** Asha on her phone, its clock 20 minutes fast. */
    ashaSkewed: async () =>
      as(
        (await world.signIn(phones.asha, ashasPhone)).accessToken,
        new Date(Date.now() + 20 * 60_000).toISOString(),
      ),
  };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

/** Fills a form on a phone; returns the submission's ID. */
async function submit(api: Api, form = 'note', text = 'All well') {
  const id = newId();
  const sent = await api.post('/v1/submissions', {
    id,
    form: { key: form, version: 1 },
    capturedAt: new Date().toISOString(),
    fix: { location: HERE, accuracy: 12, mocked: false, capturedAt: new Date().toISOString() },
    values: { text },
  });
  expect(sent.statusCode).toBe(201);
  return id;
}

const ids = (reply: { json: () => { items: { id: string }[] } }) =>
  reply.json().items.map((item) => item.id);

describe('the review queue (M7)', () => {
  it('shows reviewers what people in their scope sent, never their own, by the filters asked', async () => {
    const t = await tenant('Queue Co');
    const ashas = await submit(t.api.asha);
    const ravis = await submit(t.api.ravi);
    const managers = await submit(t.api.manager);
    const skewed = await submit(await t.ashaSkewed(), 'quick_note');

    expect(ids(await t.api.manager.get('/v1/reviews/queue')).sort()).toEqual(
      [ashas, skewed].sort(),
    );
    expect(ids(await t.api.admin.get('/v1/reviews/queue')).sort()).toEqual(
      [ashas, ravis, managers, skewed].sort(),
    );
    expect(ids(await t.api.admin.get('/v1/reviews/queue?flag=clock_skew'))).toEqual([skewed]);
    expect(ids(await t.api.admin.get('/v1/reviews/queue?formKey=quick_note'))).toEqual([skewed]);
    expect(ids(await t.api.admin.get(`/v1/reviews/queue?userId=${t.ravi.id}`))).toEqual([ravis]);
    expect(ids(await t.api.admin.get('/v1/reviews/queue?from=2020-01-01&to=2020-12-31'))).toEqual(
      [],
    );
    expect(ids(await t.api.admin.get('/v1/reviews/queue?status=approved'))).toEqual([]);

    const [item] = (
      await t.api.manager.get(`/v1/reviews/queue?userId=${t.asha.id}&formKey=note`)
    ).json().items;
    expect(item).toMatchObject({
      id: ashas,
      user: { id: t.asha.id },
      form: { key: 'note', version: 1 },
      values: { text: 'All well' },
      status: 'pending',
      flags: [],
      photoDetails: [],
      integrityWarning: false,
      autoApproveAt: null,
      reviews: [],
    });
    expect((await t.api.ravi.get('/v1/reviews/queue')).json().error.code).toBe('FORBIDDEN');
  });

  it('counts the queue for its chips, lists those with flags, and gives the account’s geofence', async () => {
    const t = await tenant('Counts Co');
    const made = await t.api.admin.post('/v1/forms', {
      definition: {
        key: 'visit_note',
        name: noun('visit_note'),
        icon: 'notebook-pen',
        review: 'manual',
        accountLink: { mode: 'optional', accountTypes: ['customer'] },
        fields: [{ key: 'text', type: 'short_text', label: { en: 'Text', hi: 'Text' } }],
      },
    });
    expect(made.statusCode).toBe(201);
    const shop = newId();
    const opened = await t.api.admin.post('/v1/accounts', {
      id: shop,
      type: 'customer',
      code: `C-${newId().slice(-8)}`,
      name: 'Sharma Stores',
      territoryId: await world.territory(t.tenantId, `T-${newId().slice(-6)}`),
      location: HERE,
      slots: { executive: t.asha.id },
    });
    expect(opened.statusCode).toBe(201);
    const atShop = newId();
    const sent = await t.api.asha.post('/v1/submissions', {
      id: atShop,
      form: { key: 'visit_note', version: 1 },
      accountId: shop,
      capturedAt: new Date().toISOString(),
      fix: { location: HERE, accuracy: 12, mocked: false, capturedAt: new Date().toISOString() },
      values: { text: 'Shelf full' },
    });
    expect(sent.statusCode, sent.body).toBe(201);
    const flagged = await submit(await t.ashaSkewed());
    const done = await submit(t.api.asha);
    await t.api.manager.post(`/v1/submissions/${done}/review`, { decision: 'approved' });

    const first = (await t.api.manager.get('/v1/reviews/queue?limit=1')).json();
    expect(first.summary).toEqual({
      counts: { pending: 2, flagged: 1, clean: 1, approved: 1, rejected: 0 },
      autoApproval: expect.any(Boolean),
      delayHours: expect.any(Number),
    });
    // Later pages leave the summary out; the chips keep the first page's.
    const next = (
      await t.api.manager.get(`/v1/reviews/queue?limit=1&cursor=${first.nextCursor}`)
    ).json();
    expect(next.summary).toBeNull();
    // The counts follow the filters but status and flags.
    expect(
      (await t.api.manager.get('/v1/reviews/queue?formKey=visit_note')).json().summary.counts,
    ).toEqual({ pending: 1, flagged: 0, clean: 1, approved: 0, rejected: 0 });

    expect(ids(await t.api.manager.get('/v1/reviews/queue?flagged=yes'))).toEqual([flagged]);
    expect(ids(await t.api.manager.get('/v1/reviews/queue?flagged=no'))).toEqual([atShop]);
    const items = (await t.api.manager.get('/v1/reviews/queue')).json().items as {
      id: string;
      geofenceAt: unknown;
    }[];
    expect(items.find((item) => item.id === atShop)?.geofenceAt).toEqual({
      location: HERE,
      radiusM: expect.any(Number),
    });
    expect(items.find((item) => item.id === flagged)?.geofenceAt).toBeNull();
  });
});

describe('deciding (M7)', () => {
  it('approves, rejects only with a note, changes a decision with one, and keeps every decision', async () => {
    const t = await tenant('Decide Co');
    const id = await submit(t.api.asha);
    const decide = (body: object, key?: string) =>
      t.api.manager.post(`/v1/submissions/${id}/review`, body, key);

    const vague = await decide({ decision: 'rejected', note: 'no' });
    expect(vague.json().error).toMatchObject({
      code: 'VALIDATION',
      details: [{ path: 'note', issue: 'Write at least 3 characters' }],
    });
    const key = newId();
    const approved = await decide({ decision: 'approved' }, key);
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'approved', autoApproved: false });
    // The same request again changes nothing.
    expect((await decide({ decision: 'approved' }, key)).json().reviews).toHaveLength(1);
    expect((await decide({ decision: 'approved' })).json().reviews).toHaveLength(1);

    const unexplained = await decide({ decision: 'rejected' });
    expect(unexplained.json().error.code).toBe('VALIDATION');
    const rejected = await decide({
      decision: 'rejected',
      note: 'The shelf photo is of another shop',
    });
    expect(rejected.json()).toMatchObject({
      status: 'rejected',
      reviews: [
        { decision: 'approved', note: null, auto: false, reviewer: { id: t.manager.id } },
        {
          decision: 'rejected',
          note: 'The shelf photo is of another shop',
          reviewer: { id: t.manager.id },
        },
      ],
    });
    const [listed] = (await t.api.asha.get(`/v1/submissions?userId=${t.asha.id}`)).json().items;
    expect(listed.status).toBe('rejected');
  });

  it('never lets anyone review their own work, or work outside their scope', async () => {
    const t = await tenant('Own Co');
    const managers = await submit(t.api.manager);
    const ravis = await submit(t.api.ravi);
    const own = await t.api.manager.post(`/v1/submissions/${managers}/review`, {
      decision: 'approved',
    });
    expect(own.json().error.code).toBe('FORBIDDEN');
    const outside = await t.api.manager.post(`/v1/submissions/${ravis}/review`, {
      decision: 'approved',
    });
    expect(outside.json().error.code).toBe('OUT_OF_SCOPE');
    const nowhere = await t.api.manager.post(`/v1/submissions/${newId()}/review`, {
      decision: 'approved',
    });
    expect(nowhere.json().error.code).toBe('NOT_FOUND');
    expect(
      (await t.api.ravi.post(`/v1/submissions/${managers}/review`, { decision: 'approved' })).json()
        .error.code,
    ).toBe('FORBIDDEN');
  });

  it('approves in bulk only what is pending, unflagged, in scope and not their own', async () => {
    const t = await tenant('Bulk Co');
    const clean = await submit(t.api.asha);
    const flagged = await submit(await t.ashaSkewed());
    const done = await submit(t.api.asha);
    await t.api.manager.post(`/v1/submissions/${done}/review`, { decision: 'approved' });
    const managers = await submit(t.api.manager);
    const ravis = await submit(t.api.ravi);
    const nowhere = newId();
    const bulk = await t.api.manager.post('/v1/reviews/bulk', {
      ids: [clean, flagged, done, managers, ravis, nowhere],
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json()).toEqual({
      approved: [clean],
      skipped: [
        { id: flagged, reason: 'FLAGGED' },
        { id: done, reason: 'NOT_PENDING' },
        { id: managers, reason: 'OWN_WORK' },
        { id: ravis, reason: 'OUT_OF_SCOPE' },
        { id: nowhere, reason: 'NOT_FOUND' },
      ],
    });
    expect((await t.api.asha.post('/v1/reviews/bulk', { ids: [clean] })).json().error.code).toBe(
      'FORBIDDEN',
    );
  });
});

describe('auto-approval (M7, decision D51)', () => {
  const autoApprove = (t: Tenant, at: number) =>
    app.get(ReviewService).autoApprove(t.tenantId, new Date(at));

  it('approves, after the delay, what the tenant lets it, unless a reviewer acts first', async () => {
    const t = await tenant('Auto Co');
    expect((await t.api.admin.get('/v1/review-rules')).json()).toEqual({
      autoApproval: false,
      delayHours: 24,
    });
    const before = await submit(t.api.asha, 'quick_note');
    const rules = await t.api.admin.put('/v1/review-rules', { autoApproval: true, delayHours: 2 });
    expect(rules.json()).toEqual({ autoApproval: true, delayHours: 2 });
    expect(
      (await t.api.manager.put('/v1/review-rules', { autoApproval: false, delayHours: 2 })).json()
        .error.code,
    ).toBe('FORBIDDEN');

    const quick = await submit(t.api.asha, 'quick_note');
    const decided = await submit(t.api.asha, 'quick_note');
    const manual = await submit(t.api.asha, 'note');
    const flagged = await submit(await t.ashaSkewed(), 'quick_note');
    const queue = async () =>
      new Map<string, { autoApproveAt: string | null; status: string }>(
        (await t.api.admin.get('/v1/reviews/queue?limit=100'))
          .json()
          .items.map((item: { id: string; autoApproveAt: string | null; status: string }) => [
            item.id,
            item,
          ]),
      );
    const waiting = await queue();
    expect(Date.parse(waiting.get(quick)!.autoApproveAt!)).toBeGreaterThan(Date.now() + 1.9 * H);
    for (const id of [before, manual, flagged]) expect(waiting.get(id)!.autoApproveAt).toBeNull();

    await t.api.manager.post(`/v1/submissions/${decided}/review`, {
      decision: 'rejected',
      note: 'Wrong place',
    });
    expect(await autoApprove(t, Date.now() + H)).toBe(0);
    expect(await autoApprove(t, Date.now() + 3 * H)).toBe(1);
    const [approved] = (
      await t.api.admin.get(`/v1/reviews/queue?status=approved&userId=${t.asha.id}`)
    ).json().items;
    expect(approved).toMatchObject({
      id: quick,
      autoApproved: true,
      reviews: [{ decision: 'approved', auto: true, reviewer: null, note: null }],
    });
    const left = await queue();
    expect([...left.keys()].sort()).toEqual([before, manual, flagged].sort());
  });

  it('leaves to a person what a device with an integrity warning sent', async () => {
    const t = await tenant('Integrity Co');
    await t.api.admin.put('/v1/review-rules', { autoApproval: true, delayHours: 1 });
    const id = await submit(t.api.asha, 'quick_note');
    await world.database.forTenant(t.tenantId, (tx) =>
      tx.execute(
        `update cell.devices set integrity_verdict = 'MEETS_BASIC_INTEGRITY'
          where tenant_id = '${t.tenantId}' and user_id = '${t.asha.id}'`,
      ),
    );
    expect(await autoApprove(t, Date.now() + 2 * H)).toBe(0);
    const [item] = (await t.api.admin.get('/v1/reviews/queue')).json().items;
    expect(item).toMatchObject({
      id,
      status: 'pending',
      autoApproveAt: null,
      integrityWarning: true,
    });
  });
});
