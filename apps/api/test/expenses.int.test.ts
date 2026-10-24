import { createHash } from 'node:crypto';
import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PhotosService } from '../src/modules/media/photos.service';
import { type MemoryObjectStore, ObjectStore } from '../src/platform/object-store';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Expenses (M12, BR-29, BR-30, decision D83). */

let app: NestFastifyApplication;
let world: World;
let store: MemoryObjectStore;

beforeAll(async () => {
  app = await startApp(testConfig());
  world = await World.create(app);
  store = app.get(ObjectStore) as MemoryObjectStore;
});

afterAll(async () => {
  await world.end();
  await app.close();
});

function as(token: string) {
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
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
    patch: (url: string, payload: object) => call('PATCH', url, payload),
  };
}
type Api = ReturnType<typeof as>;

const DAY = 86_400_000;
const after = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const TODAY = () => todayIn('Asia/Kolkata');
/** A day last month, so claims for it are all in one month whatever today is. */
const LAST_MONTH = () => after(`${TODAY().slice(0, 7)}-01`, -20);

/** A photo of a scene, unlike any other scene. */
async function jpeg(scene: number): Promise<Uint8Array> {
  const width = 64;
  const height = 48;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * (scene + 3)) % 256;
  return new Uint8Array(
    await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg()
      .toBuffer(),
  );
}

async function upload(api: Api, kind: string, bytes: Uint8Array) {
  const id = newId();
  const presigned = await api.post('/v1/media/presign', {
    id,
    kind,
    contentType: 'image/jpeg',
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  expect(presigned.statusCode, presigned.body).toBe(200);
  const { upload: link } = presigned.json();
  if (link) store.receive(link.url, bytes);
  const confirmed = await api.post(`/v1/media/${id}/confirm`, {
    capturedAt: new Date().toISOString(),
    source: 'camera',
    fix: { lat: 28.6315, lng: 77.2167, accuracy: 12, capturedAt: new Date().toISOString() },
  });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  return id;
}

const named = (en: string) => ({ en, hi: en });
const POLICIES = [
  {
    key: 'fuel',
    name: named('Fuel'),
    category: 'travel',
    calculation: 'per_km',
    rate: { flat: '8' },
    odometerPhotosRequired: true,
  },
  {
    key: 'da',
    name: named('Daily allowance'),
    category: 'daily_allowance',
    calculation: 'per_day',
    rate: { byDesignation: { executive: '500', manager: '700' } },
    caps: { perClaim: '1200', perMonth: '3000' },
  },
  {
    key: 'meals',
    name: named('Meals'),
    category: 'other',
    calculation: 'actual',
    caps: { perDay: '500' },
    receiptRequired: true,
  },
  {
    key: 'visits',
    name: named('Visit allowance'),
    category: 'other',
    calculation: 'per_visit',
    rate: { flat: '25' },
  },
];

/** A tenant with its head (the admin), a manager, a field user, and the policies above. */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { head: newPhone(), manager: newPhone(), field: newPhone() };
  const head = await world.user(tenantId, {
    phone: phones.head,
    designation: 'head',
    role: 'tenant_admin',
  });
  const manager = await world.user(tenantId, {
    phone: phones.manager,
    designation: 'manager',
    managerId: head.id,
  });
  const field = await world.user(tenantId, {
    phone: phones.field,
    designation: 'executive',
    managerId: manager.id,
    joiningDate: '2020-01-01',
  });
  const t = {
    tenantId,
    fieldId: field.id,
    head: as((await world.signIn(phones.head)).accessToken),
    manager: as((await world.signIn(phones.manager)).accessToken),
    field: as((await world.signIn(phones.field, newDevice())).accessToken),
  };
  const set = await t.head.put('/v1/expense-policies', {
    items: POLICIES,
    from: after(LAST_MONTH(), -30),
  });
  expect(set.statusCode, set.body).toBe(200);
  return t;
}

const claim = (api: Api, body: object) =>
  api.post('/v1/expense-claims', { id: newId(), expenseDate: LAST_MONTH(), ...body });

describe('expense claims (BR-29)', () => {
  it('FX-21 and FX-22, caps across the month, and what refuses a claim', async () => {
    const t = await tenant('Expense Co');
    const photos = [
      await upload(t.field, 'odometer', await jpeg(1)),
      await upload(t.field, 'odometer', await jpeg(2)),
    ];
    const fuel = await claim(t.field, {
      policy: 'fuel',
      description: 'Rampur and back',
      odometerOpen: '1000',
      odometerClose: '1042',
      odometerPhotoIds: photos,
    });
    expect(fuel.statusCode, fuel.body).toBe(201);
    expect(fuel.json()).toMatchObject({
      quantity: '42.000',
      rate: '8.00',
      calculated: '336.00',
      amount: '336.00',
      capped: false,
      odometerPhotos: photos,
      state: 'pending',
      approval: { requestType: 'expense', subject: { title: '336.00 · Rampur and back' } },
    });
    const refused = await claim(t.field, {
      policy: 'fuel',
      description: 'Backwards',
      odometerOpen: '1042',
      odometerClose: '1000',
    });
    expect(refused.json().error.details).toEqual([
      { path: 'odometerClose', issue: 'The closing reading is below the opening one' },
      { path: 'odometerPhotoIds', issue: 'Add photos of the opening and closing readings' },
    ]);
    // A photo already on a claim belongs to it.
    const reused = await claim(t.field, {
      policy: 'fuel',
      description: 'Again',
      odometerOpen: '1',
      odometerClose: '2',
      odometerPhotoIds: photos,
    });
    expect(reused.json().error.details[0]).toEqual({
      path: 'odometerPhotoIds[0]',
      issue: 'This photo belongs to another record',
    });

    // FX-22, then the month's cap of 3,000.
    const da = (days: string) => claim(t.field, { policy: 'da', description: 'Tour', days });
    expect((await da('3')).json()).toMatchObject({
      calculated: '1500.00',
      amount: '1200.00',
      capped: true,
      flags: ['capped'],
    });
    expect((await da('2')).json()).toMatchObject({ amount: '1000.00', capped: false });
    expect((await da('3')).json()).toMatchObject({ amount: '800.00', capped: true });
    expect((await da('1')).json().error.details).toEqual([
      { path: 'policy', issue: 'The caps for this day or month are used up' },
    ]);

    expect(
      (
        await claim(t.field, {
          policy: 'meals',
          description: 'Lunch tomorrow',
          billAmount: '100',
          expenseDate: after(TODAY(), 1),
        })
      ).json().error.details,
    ).toEqual([{ path: 'expenseDate', issue: 'Claim for a day that has passed or today' }]);
    expect(
      (await claim(t.field, { policy: 'visits', description: 'Visits' })).json().error.details,
    ).toEqual([{ path: 'expenseDate', issue: 'You completed no visits on this day' }]);
    expect(
      (await claim(t.field, { policy: 'nowhere', description: 'Nothing' })).json().error.details,
    ).toEqual([{ path: 'policy', issue: 'There is no expense policy in force on this day' }]);
  });
});

describe('receipts and approval (BR-30)', () => {
  it('holds every step without a receipt, takes receipts while waiting, and is paid once', async () => {
    const t = await tenant('Receipt Co');
    const meals = await claim(t.field, {
      policy: 'meals',
      description: 'Team lunch',
      billAmount: '412.50',
    });
    expect(meals.json()).toMatchObject({ amount: '412.50', flags: ['receipt_missing'] });
    const approval = meals.json().approval;
    const held = await t.manager.post(`/v1/approvals/${approval.id}/decision`, {
      decision: 'approve',
      version: approval.version,
    });
    expect(held.statusCode).toBe(400);
    expect(held.json().error.code).toBe('PHOTO_REQUIRED');

    const bytes = await jpeg(7);
    const receipt = await upload(t.field, 'receipt', bytes);
    const added = await t.field.post(`/v1/expense-claims/${meals.json().id}/receipts`, {
      mediaIds: [receipt],
    });
    expect(added.statusCode, added.body).toBe(200);
    expect(added.json()).toMatchObject({ receipts: [receipt], flags: [] });
    expect(
      (
        await t.manager.post(`/v1/expense-claims/${meals.json().id}/receipts`, {
          mediaIds: [receipt],
        })
      ).json().error.code,
    ).toBe('FORBIDDEN');

    const first = await t.manager.post(`/v1/approvals/${approval.id}/decision`, {
      decision: 'approve',
      version: approval.version,
    });
    expect(first.statusCode, first.body).toBe(200);
    const last = await t.head.post(`/v1/approvals/${approval.id}/decision`, {
      decision: 'approve',
      version: first.json().version,
    });
    expect(last.json().status).toBe('approved');
    expect(
      (
        await t.field.post(`/v1/expense-claims/${meals.json().id}/receipts`, {
          mediaIds: [receipt],
        })
      ).json().error.code,
    ).toBe('CONFLICT');

    expect(
      (await t.manager.post(`/v1/expense-claims/${meals.json().id}/paid`, {})).json().error.code,
    ).toBe('FORBIDDEN');
    const paid = await t.head.post(`/v1/expense-claims/${meals.json().id}/paid`, {
      reference: 'NEFT 4471',
    });
    expect(paid.json()).toMatchObject({ state: 'paid', paymentReference: 'NEFT 4471' });
    expect(
      (await t.head.post(`/v1/expense-claims/${meals.json().id}/paid`, {})).json().error.code,
    ).toBe('CONFLICT');

    // The same receipt on two claims flags both (BR-40), never blocking either.
    const again = await upload(t.field, 'receipt', bytes);
    const second = await claim(t.field, {
      policy: 'meals',
      description: 'Team lunch again',
      billAmount: '50',
      expenseDate: after(LAST_MONTH(), 1),
      receiptIds: [again],
    });
    expect(second.statusCode, second.body).toBe(201);
    await app.get(PhotosService).process(t.tenantId, receipt);
    await app.get(PhotosService).process(t.tenantId, again);
    const listed = (
      await t.head.get(`/v1/expense-claims?period=${LAST_MONTH().slice(0, 7)}`)
    ).json();
    expect(listed.items.map((item: { flags: string[] }) => item.flags)).toEqual([
      ['duplicate_receipt'],
      ['duplicate_receipt'],
    ]);
    // The day's cap counts the paid claim: 412.50 of 500 is spent on that day.
    expect(
      (await claim(t.field, { policy: 'meals', description: 'Tea', billAmount: '100' })).json(),
    ).toMatchObject({ amount: '87.50', capped: true });

    // The expense register, the payroll export's source.
    const register = (
      await t.head.get(`/v1/reports/expense_register?period=${LAST_MONTH().slice(0, 7)}`)
    ).json();
    expect(register.rows[0]).toMatchObject({
      policy: 'Meals',
      description: 'Team lunch',
      amount: 412.5,
      receipts: 1,
      status: 'Paid',
      reference: 'NEFT 4471',
    });
  });
});

describe('expense policies (spec 5.10)', () => {
  it('versions a change from a day, keeps every policy, and refuses claims of one switched off', async () => {
    const t = await tenant('Policy Co');
    const yesterday = after(TODAY(), -1);
    const tomorrow = after(TODAY(), 1);
    const changed = await t.head.put('/v1/expense-policies', {
      items: [
        { ...POLICIES[0], rate: { flat: '9' } },
        ...POLICIES.slice(1, 3),
        { ...POLICIES[3], active: false },
      ],
      from: tomorrow,
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().items[0]).toMatchObject({
      key: 'fuel',
      version: 2,
      validFrom: tomorrow,
      rate: { flat: '9' },
    });
    // A day before the change keeps the version in force then.
    const photos = [
      await upload(t.field, 'odometer', await jpeg(3)),
      await upload(t.field, 'odometer', await jpeg(4)),
    ];
    const fuel = await claim(t.field, {
      policy: 'fuel',
      description: 'Before the change',
      expenseDate: yesterday,
      odometerOpen: '10',
      odometerClose: '20',
      odometerPhotoIds: photos,
    });
    expect(fuel.json()).toMatchObject({ policyVersion: 1, rate: '8.00', amount: '80.00' });
    expect(
      (
        await claim(t.field, { policy: 'visits', description: 'Visits', expenseDate: yesterday })
      ).json().error.details[0],
    ).toEqual({ path: 'policy', issue: 'This expense policy is switched off' });

    const dropped = await t.head.put('/v1/expense-policies', { items: POLICIES.slice(1) });
    expect(dropped.json().error.details).toContainEqual({
      path: 'items',
      issue: 'Keep fuel; switch it off instead of removing it',
    });
    const wrong = await t.head.put('/v1/expense-policies', {
      items: [{ ...POLICIES[0], rate: { byDesignation: { nobody: '5' } } }, ...POLICIES.slice(1)],
    });
    expect(wrong.json().error.details).toContainEqual({
      path: 'items[0].rate.byDesignation.nobody',
      issue: 'There is no designation `nobody`',
    });
    expect(
      (await t.manager.put('/v1/expense-policies', { items: POLICIES })).json().error.code,
    ).toBe('FORBIDDEN');
    // Field users see the policies, to claim against them.
    expect((await t.field.get('/v1/expense-policies')).json().items).toHaveLength(4);
    // Only their own claims.
    const own = (await t.field.get('/v1/expense-claims')).json();
    expect(own.items.map((item: { userId: string }) => item.userId)).toEqual([t.fieldId]);
  });
});

describe('expenses switched off (M2, decision D84)', () => {
  it('keeps a waiting claim out of the inbox and undecided until the module is on again', async () => {
    const t = await tenant('Expenses Off Co');
    const made = await claim(t.field, { policy: 'da', description: 'Tour', days: '1' });
    expect(made.statusCode, made.body).toBe(201);
    const { id, version } = made.json().approval;
    const inbox = async () => (await t.manager.get('/v1/approvals/inbox')).json();
    expect(await inbox()).toMatchObject({ items: [{ id }], counts: { expense: 1 } });

    expect((await t.head.patch('/v1/settings', { modulesOff: ['expenses'] })).statusCode).toBe(200);
    expect(await inbox()).toEqual({ items: [], nextCursor: null, counts: {} });
    const decided = await t.manager.post(`/v1/approvals/${id}/decision`, {
      decision: 'approve',
      version,
    });
    expect(decided.json().error.code).toBe('MODULE_DISABLED');

    expect((await t.head.patch('/v1/settings', { modulesOff: [] })).statusCode).toBe(200);
    expect(await inbox()).toMatchObject({ items: [{ id, version }], counts: { expense: 1 } });
    const approved = await t.manager.post(`/v1/approvals/${id}/decision`, {
      decision: 'approve',
      version,
    });
    expect(approved.statusCode, approved.body).toBe(200);
  });
});
