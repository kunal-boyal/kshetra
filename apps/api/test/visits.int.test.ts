import { createHash } from 'node:crypto';
import { newId } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SubmissionsService } from '../src/modules/field/submissions.service';
import { VisitsService } from '../src/modules/field/visits.service';
import { PhotosService } from '../src/modules/media/photos.service';
import { type MemoryObjectStore, ObjectStore } from '../src/platform/object-store';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Visits and submissions (M6, BR-32, BR-33, BR-34). */

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

const H = 3_600_000;
/** Connaught Place, New Delhi; FAR is about 2 km north. */
const HERE = { lat: 28.6315, lng: 77.2167 };
const FAR = { lat: 28.6495, lng: 77.2167 };

function as(token: string, deviceTime?: string) {
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': newId(),
        ...(deviceTime ? { 'x-device-time': deviceTime } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object) => call('POST', url, payload),
  };
}

type Api = ReturnType<typeof as>;

const fix = (at: number, location = HERE, overrides: object = {}) => ({
  location,
  accuracy: 15,
  mocked: false,
  capturedAt: new Date(at).toISOString(),
  ...overrides,
});

/**
 * A tenant on the generic template: its admin on the web, a manager, and two executives on
 * phones; a customer the first executive serves at HERE, one of the other's, and one far away.
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
  const adminToken = (await world.signIn(phones.admin)).accessToken;
  const api = {
    admin: as(adminToken),
    manager: as((await world.signIn(phones.manager)).accessToken),
    asha: as((await world.signIn(phones.asha, ashasPhone)).accessToken),
    ravi: as((await world.signIn(phones.ravi, newDevice())).accessToken),
  };
  const territoryId = await world.territory(tenantId, `T-${newId().slice(-6)}`);
  const customer = async (holder: string, location = HERE) => {
    const id = newId();
    const made = await api.admin.post('/v1/accounts', {
      id,
      type: 'customer',
      code: `C-${newId().slice(-8)}`,
      name: 'Sharma Stores',
      territoryId,
      location,
      slots: { executive: holder },
    });
    expect(made.statusCode).toBe(201);
    return id;
  };
  return {
    tenantId,
    asha,
    ravi,
    api,
    adminToken,
    /** Asha on her phone, its clock 20 minutes fast. */
    ashaSkewed: async () =>
      as(
        (await world.signIn(phones.asha, ashasPhone)).accessToken,
        new Date(Date.now() + 20 * 60_000).toISOString(),
      ),
    shop: await customer(asha.id),
    farShop: await customer(asha.id, FAR),
    ravisShop: await customer(ravi.id),
  };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

async function punchIn(api: Api, at = Date.now() - 2 * H) {
  const id = newId();
  const opened = await api.post('/v1/shifts', {
    id,
    startedAt: new Date(at).toISOString(),
    location: HERE,
    accuracy: 15,
    mocked: false,
    consentVersion: '2026-10',
  });
  expect(opened.statusCode).toBe(201);
  return id;
}

const checkIn = (accountId: string, at = Date.now(), location = HERE) => ({
  id: newId(),
  accountId,
  checkedInAt: new Date(at).toISOString(),
  fix: fix(at, location),
});

/** A JPEG of its own: `scene` picks the stripes. */
async function jpeg(scene: number): Promise<Uint8Array> {
  const width = 320;
  const height = 240;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const band = Math.floor((x * Math.cos(scene) + y * Math.sin(scene)) / 30) % 2;
      const i = (y * width + x) * 3;
      pixels[i] = band ? 40 + scene * 20 : 200;
      pixels[i + 1] = (x + scene * 30) % 256;
      pixels[i + 2] = (y + scene * 50) % 256;
    }
  }
  return new Uint8Array(
    await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg()
      .toBuffer(),
  );
}

/** What the phone does: register, upload straight to storage, confirm. */
async function photo(
  api: Api,
  options: { scene?: number; source?: 'camera' | 'gallery'; at?: number; bytes?: Uint8Array } = {},
) {
  const id = newId();
  const bytes = options.bytes ?? (await jpeg(options.scene ?? Math.random() * 6));
  const presigned = await api.post('/v1/media/presign', {
    id,
    kind: 'evidence',
    contentType: 'image/jpeg',
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  expect(presigned.statusCode).toBe(200);
  store.receive(presigned.json().upload.url, bytes);
  const at = new Date(options.at ?? Date.now()).toISOString();
  const confirmed = await api.post(`/v1/media/${id}/confirm`, {
    capturedAt: at,
    source: options.source ?? 'camera',
    fix: { ...HERE, accuracy: 12, capturedAt: at },
  });
  expect(confirmed.statusCode).toBe(200);
  return id;
}

const visitForm = (overrides: object = {}) => ({
  id: newId(),
  form: { key: 'customer_visit', version: 1 },
  capturedAt: new Date().toISOString(),
  fix: fix(Date.now()),
  values: { person_met: 'Mr Sharma', purpose: 'follow_up', outcome: 'Agreed to stock more' },
  photos: [] as string[],
  ...overrides,
});

const text = (en: string) => ({ en, hi: en });

/** Publishes a form of the tenant's own for one test. */
async function publish(t: Tenant, definition: object) {
  const made = await t.api.admin.post('/v1/forms', {
    definition: {
      name: { en: { one: 'Check', other: 'Checks' }, hi: { one: 'जाँच', other: 'जाँचें' } },
      icon: 'clipboard-check',
      ...definition,
    },
  });
  expect(made.statusCode).toBe(201);
}

describe('checking in and out (M6, BR-33, BR-34)', () => {
  it('checks in on a shift inside the geofence, replays, and checks out', async () => {
    const t = await tenant('Visit Co');
    const shiftId = await punchIn(t.api.asha);
    const body = checkIn(t.shop);
    const visit = await t.api.asha.post('/v1/visits', body);
    expect(visit.statusCode).toBe(201);
    expect(visit.json()).toMatchObject({
      id: body.id,
      userId: t.asha.id,
      shiftId,
      account: { id: t.shop, name: 'Sharma Stores' },
      distanceM: 0,
      geofence: 'inside',
      checkedOutAt: null,
      flags: [],
    });
    expect((await t.api.asha.post('/v1/visits', body)).json().id).toBe(body.id);
    expect((await t.api.asha.get('/v1/visits/current')).json().visit.id).toBe(body.id);

    const out = new Date().toISOString();
    const checkedOut = await t.api.asha.post(`/v1/visits/${body.id}/check-out`, {
      checkedOutAt: out,
      fix: fix(Date.now()),
    });
    expect(checkedOut.json()).toMatchObject({ checkedOutAt: out, endReason: 'check_out' });
    const again = await t.api.asha.post(`/v1/visits/${body.id}/check-out`, {
      checkedOutAt: new Date().toISOString(),
    });
    expect(again.json().checkedOutAt).toBe(out);
    expect((await t.api.asha.get('/v1/visits/current')).json().visit).toBeNull();
    expect(
      (await t.api.ravi.post(`/v1/visits/${body.id}/check-out`, { checkedOutAt: out })).json().error
        .code,
    ).toBe('OUT_OF_SCOPE');
  });

  it('refuses one off shift, on the web, out of scope or with a bad fix', async () => {
    const t = await tenant('Refusing Co');
    expect((await t.api.asha.post('/v1/visits', checkIn(t.shop))).json().error.code).toBe(
      'NOT_ON_SHIFT',
    );
    await punchIn(t.api.asha);
    expect((await t.api.admin.post('/v1/visits', checkIn(t.shop))).json().error.code).toBe(
      'USE_MOBILE_APP',
    );
    expect((await t.api.asha.post('/v1/visits', checkIn(t.ravisShop))).json().error.code).toBe(
      'OUT_OF_SCOPE',
    );
    expect((await t.api.asha.post('/v1/visits', checkIn(newId()))).json().error.code).toBe(
      'NOT_FOUND',
    );
    const stale = checkIn(t.shop);
    stale.fix = fix(Date.now() - 5 * 60_000);
    expect((await t.api.asha.post('/v1/visits', stale)).json().error.code).toBe('GPS_STALE');
    const mocked = checkIn(t.shop);
    mocked.fix = fix(Date.now(), HERE, { mocked: true });
    expect((await t.api.asha.post('/v1/visits', mocked)).json().error.code).toBe('GPS_MOCKED');
  });

  it('lets an advisory geofence through with the distance, and holds a required one', async () => {
    const t = await tenant('Fence Co');
    await punchIn(t.api.asha);
    const outside = await t.api.asha.post('/v1/visits', checkIn(t.farShop));
    expect(outside.json()).toMatchObject({ geofence: 'outside' });
    expect(outside.json().distanceM).toBeGreaterThan(1_900);

    const types = (await t.api.admin.get('/v1/account-types')).json().items;
    const customer = types.find((type: { key: string }) => type.key === 'customer');
    const definition = Object.fromEntries(
      Object.entries(customer as object).filter(
        ([key]) => !['id', 'version', 'active'].includes(key),
      ),
    ) as { location: object };
    const published = await t.api.admin.post(`/v1/account-types/${customer.id}/versions`, {
      definition: {
        ...definition,
        location: { ...definition.location, geofencePolicy: 'required' },
      },
    });
    expect(published.statusCode).toBe(201);
    const refused = await t.api.asha.post('/v1/visits', checkIn(t.farShop));
    expect(refused.json().error.code).toBe('OUTSIDE_GEOFENCE');
    expect(refused.json().error.message).toMatch(
      /^You are 19\d\d m away; this needs you within 300 m/,
    );
  });

  it('checks out for the person at the next check-in, at punch-out, and after 4 idle hours', async () => {
    const t = await tenant('Auto Co');
    const shiftId = await punchIn(t.api.asha, Date.now() - 6 * H);
    const first = checkIn(t.shop, Date.now() - 5 * H);
    await t.api.asha.post('/v1/visits', first);
    const second = checkIn(t.shop, Date.now() - 4.5 * H);
    await t.api.asha.post('/v1/visits', second);
    const firstVisit = await world.database.forTenant(t.tenantId, (tx) =>
      app.get(VisitsService).view(tx, t.tenantId, first.id),
    );
    expect(firstVisit).toMatchObject({
      endReason: 'next_check_in',
      checkedOutAt: second.checkedInAt,
    });

    // Nothing for 4 hours: the visit checks out 4 hours after its check-in.
    const closed = await world.database.forTenant(t.tenantId, (tx) =>
      app.get(VisitsService).closeIdle(tx, t.tenantId),
    );
    expect(closed).toBe(1);
    expect((await t.api.asha.get('/v1/visits/current')).json().visit).toBeNull();
    const idle = await world.database.forTenant(t.tenantId, (tx) =>
      app.get(VisitsService).view(tx, t.tenantId, second.id),
    );
    expect(idle).toMatchObject({
      endReason: 'idle',
      checkedOutAt: new Date(Date.parse(second.checkedInAt) + 4 * H).toISOString(),
    });

    const third = checkIn(t.shop);
    await t.api.asha.post('/v1/visits', third);
    await t.api.asha.post(`/v1/shifts/${shiftId}/end`, {
      location: HERE,
      accuracy: 15,
      mocked: false,
      endedAt: new Date().toISOString(),
    });
    const punchedOut = await world.database.forTenant(t.tenantId, (tx) =>
      app.get(VisitsService).view(tx, t.tenantId, third.id),
    );
    expect(punchedOut.endReason).toBe('punch_out');
  });
});

describe('submissions (M6, BR-32)', () => {
  it('takes a visit form inside a visit, with its photo, and replays it', async () => {
    const t = await tenant('Form Co');
    const shiftId = await punchIn(t.api.asha);
    const visit = checkIn(t.shop);
    await t.api.asha.post('/v1/visits', visit);
    const photoId = await photo(t.api.asha);
    const body = visitForm({ visitId: visit.id, photos: [photoId] });
    const sent = await t.api.asha.post('/v1/submissions', body);
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({
      id: body.id,
      user: { id: t.asha.id, name: 'Test Person' },
      form: { key: 'customer_visit', version: 1, name: { en: { one: 'Customer visit' } } },
      account: { id: t.shop },
      visitId: visit.id,
      shiftId,
      distanceM: 0,
      geofence: 'inside',
      values: body.values,
      photos: [photoId],
      flags: [],
      status: 'pending',
    });
    expect((await t.api.asha.post('/v1/submissions', body)).json().id).toBe(body.id);
    expect(
      (
        await t.api.asha.post('/v1/submissions', {
          ...body,
          values: { ...body.values, outcome: 'No' },
        })
      ).json().error.code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    const [owned] = await world.database.forTenant(t.tenantId, (tx) =>
      tx
        .execute<{ owner_type: string; owner_id: string }>(
          `select owner_type, owner_id from cell.media where id = '${photoId}'`,
        )
        .then((result) => result.rows),
    );
    expect(owned).toEqual({ owner_type: 'submission', owner_id: body.id });

    // The same photo can't go on another record.
    const reused = await t.api.asha.post(
      '/v1/submissions',
      visitForm({ visitId: visit.id, photos: [photoId] }),
    );
    expect(reused.json().error.details).toEqual([
      { path: 'photos[0]', issue: 'This photo belongs to another record' },
    ]);
  });

  it('refuses what the form and the evidence rules forbid', async () => {
    const t = await tenant('Strict Co');
    await punchIn(t.api.asha);
    const visit = checkIn(t.shop);
    await t.api.asha.post('/v1/visits', visit);
    const send = (body: object) => t.api.asha.post('/v1/submissions', body);
    const photoId = await photo(t.api.asha);

    expect((await send(visitForm({ photos: [photoId] }))).json().error.details).toEqual([
      { path: 'visitId', issue: 'Check in at the place first' },
    ]);
    expect((await send(visitForm({ visitId: visit.id }))).json().error.code).toBe('PHOTO_REQUIRED');
    const missing = await send(
      visitForm({ visitId: visit.id, photos: [photoId], values: { purpose: 'order' } }),
    );
    expect(missing.json().error.details.map((detail: { path: string }) => detail.path)).toEqual([
      'values.person_met',
      'values.outcome',
    ]);
    const stale = await send(
      visitForm({ visitId: visit.id, photos: [photoId], fix: fix(Date.now() - 3 * 60_000) }),
    );
    expect(stale.json().error.code).toBe('GPS_STALE');
    const future = Date.now() + 10 * 60_000;
    const ahead = await send(
      visitForm({
        visitId: visit.id,
        photos: [photoId],
        capturedAt: new Date(future).toISOString(),
        fix: fix(future),
      }),
    );
    expect(ahead.json().error.details).toContainEqual({
      path: 'capturedAt',
      issue: 'This time is in the future',
    });
    expect(ahead.json().error.code).toBe('VALIDATION');
    const ravisPhoto = await photo(t.api.ravi);
    expect(
      (await send(visitForm({ visitId: visit.id, photos: [ravisPhoto] }))).json().error.details,
    ).toEqual([{ path: 'photos[0]', issue: 'This photo was taken by someone else' }]);
    const oldPhoto = await photo(t.api.asha, { at: Date.now() - 20 * 60_000 });
    expect(
      (await send(visitForm({ visitId: visit.id, photos: [oldPhoto] }))).json().error.details,
    ).toEqual([{ path: 'photos[0]', issue: 'This photo was taken more than 5 minutes apart' }]);
    const galleryPhoto = await photo(t.api.asha, { source: 'gallery' });
    expect(
      (await send(visitForm({ visitId: visit.id, photos: [galleryPhoto] }))).json().error.details,
    ).toEqual([{ path: 'photos[0]', issue: 'This form takes photos from the camera only' }]);
    // Ravi can't record at Asha's visit.
    expect(
      (await t.api.ravi.post('/v1/submissions', visitForm({ visitId: visit.id }))).json().error
        .code,
    ).toBe('NOT_ON_SHIFT');
  });

  it('takes a standalone form on a shift, with no account', async () => {
    const t = await tenant('Meeting Co');
    const shiftId = await punchIn(t.api.asha);
    const photoId = await photo(t.api.asha);
    const sent = await t.api.asha.post('/v1/submissions', {
      id: newId(),
      form: { key: 'meeting', version: 1 },
      capturedAt: new Date().toISOString(),
      fix: fix(Date.now()),
      values: { location_name: 'Village hall', attendees: 24, topic: 'Storage', outcome: 'Good' },
      photos: [photoId],
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({
      account: null,
      visitId: null,
      shiftId,
      geofence: null,
      flags: [],
    });
    const far = await t.api.asha.post('/v1/submissions', {
      id: newId(),
      form: { key: 'meeting', version: 1 },
      capturedAt: new Date().toISOString(),
      fix: fix(Date.now(), FAR),
      values: { location_name: 'Village hall', attendees: 24, topic: 'Storage', outcome: 'Good' },
      photos: [await photo(t.api.asha)],
    });
    expect(far.json().error.details).toEqual([
      { path: 'photos[0]', issue: 'This photo was taken more than 500 m away' },
    ]);
  });

  it("follows the form's settings: off shift, no review, gallery photos, a required geofence and a signature", async () => {
    const t = await tenant('Settings Co');
    await publish(t, {
      key: 'delivery_note',
      accountLink: { mode: 'required', accountTypes: ['customer'] },
      shift: 'allowed_off_shift',
      review: 'none',
      geofence: 'required',
      signature: 'required',
      photos: { min: 0, max: 2, source: 'camera_and_gallery' },
      fields: [{ key: 'note', type: 'short_text', label: text('Note') }],
    });
    const note = (overrides: object = {}) => ({
      id: newId(),
      form: { key: 'delivery_note', version: 1 },
      accountId: t.shop,
      capturedAt: new Date().toISOString(),
      fix: fix(Date.now()),
      values: { note: 'Left with the owner' },
      signature: {
        width: 300,
        height: 120,
        strokes: ['M10 60 L80 30 Q120 10 160 60', 'M200 40 L280 90'],
      },
      ...overrides,
    });
    const unsigned = await t.api.asha.post('/v1/submissions', { ...note(), signature: undefined });
    expect(unsigned.json().error.details).toEqual([
      { path: 'signature', issue: 'Ask for a signature' },
    ]);
    expect(
      (await t.api.asha.post('/v1/submissions', note({ accountId: t.farShop }))).json().error.code,
    ).toBe('OUTSIDE_GEOFENCE');
    const script = await t.api.asha.post(
      '/v1/submissions',
      note({ signature: { width: 300, height: 120, strokes: ['M0 0"/><script>'] } }),
    );
    expect(script.json().error.code).toBe('VALIDATION');

    const galleryPhoto = await photo(t.api.asha, { source: 'gallery' });
    const body = note({ photos: [galleryPhoto] });
    const sent = await t.api.asha.post('/v1/submissions', body);
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({
      shiftId: null,
      status: 'approved',
      flags: ['gallery_photo'],
      signatureMediaId: null,
    });

    // The media worker draws the signature.
    await app.get(SubmissionsService).renderSignature(t.tenantId, body.id);
    await app.get(SubmissionsService).renderSignature(t.tenantId, body.id);
    const listed = (await t.api.asha.get(`/v1/submissions?userId=${t.asha.id}`)).json().items;
    const signatureId = listed[0].signatureMediaId;
    expect(signatureId).toEqual(expect.any(String));
    const media = await world.database.forTenant(t.tenantId, (tx) =>
      tx
        .execute<{
          kind: string;
          source: string;
          status: string;
          owner_id: string;
          object_key: string;
        }>(
          `select kind, source, status, owner_id, object_key from cell.media where owner_id = '${body.id}' and kind = 'signature'`,
        )
        .then((result) => result.rows),
    );
    expect(media).toEqual([
      expect.objectContaining({
        kind: 'signature',
        source: 'generated',
        status: 'processed',
        owner_id: body.id,
      }),
    ]);
    const image = await sharp(await store.get(media[0]!.object_key)).metadata();
    expect(image).toMatchObject({ format: 'jpeg', width: 300, height: 120 });
  });

  it('flags a skewed clock, and a duplicate photo found after the submission arrived', async () => {
    const t = await tenant('Flag Co');
    await punchIn(t.api.asha);
    const visit = checkIn(t.shop);
    await t.api.asha.post('/v1/visits', visit);
    const bytes = await jpeg(2);
    const original = await photo(t.api.asha, { bytes });
    await app.get(PhotosService).process(t.tenantId, original);
    const copy = await photo(t.api.asha, { bytes });
    const body = visitForm({ visitId: visit.id, photos: [copy] });
    const sent = await (await t.ashaSkewed()).post('/v1/submissions', body);
    expect(sent.json().flags).toEqual(['clock_skew']);
    await app.get(PhotosService).process(t.tenantId, copy);
    const [after] = (await t.api.asha.get(`/v1/submissions?userId=${t.asha.id}`)).json().items;
    expect(after.flags).toEqual(['clock_skew', 'duplicate_photo']);
  });
});

describe('listing submissions', () => {
  it("shows a person's to them and their managers, and an account's to who sees it", async () => {
    const t = await tenant('List Co');
    await punchIn(t.api.asha);
    const visit = checkIn(t.shop);
    await t.api.asha.post('/v1/visits', visit);
    const bodies = [];
    for (let index = 0; index < 3; index += 1) {
      const body = visitForm({
        visitId: visit.id,
        photos: [await photo(t.api.asha)],
        capturedAt: new Date(Date.now() - (3 - index) * 1_000).toISOString(),
      });
      await t.api.asha.post('/v1/submissions', body);
      bodies.push(body);
    }
    const first = (await t.api.asha.get(`/v1/submissions?userId=${t.asha.id}&limit=2`)).json();
    expect(first.items.map((item: { id: string }) => item.id)).toEqual([
      bodies[2]!.id,
      bodies[1]!.id,
    ]);
    const rest = (
      await t.api.asha.get(
        `/v1/submissions?userId=${t.asha.id}&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
      )
    ).json();
    expect(rest).toEqual({
      items: [expect.objectContaining({ id: bodies[0]!.id })],
      nextCursor: null,
    });
    expect(
      (await t.api.manager.get(`/v1/submissions?userId=${t.asha.id}`)).json().items,
    ).toHaveLength(3);
    expect(
      (await t.api.admin.get(`/v1/submissions?accountId=${t.shop}`)).json().items,
    ).toHaveLength(3);
    expect((await t.api.ravi.get(`/v1/submissions?userId=${t.asha.id}`)).json().error.code).toBe(
      'OUT_OF_SCOPE',
    );
    expect((await t.api.ravi.get(`/v1/submissions?accountId=${t.shop}`)).json().error.code).toBe(
      'OUT_OF_SCOPE',
    );
    expect((await t.api.admin.get('/v1/submissions')).json().error.code).toBe('VALIDATION');
  });
});

describe('form engine additions in a visit (decision D97)', () => {
  it('asks why there was no order only when none was taken, and a signature when samples are given', async () => {
    const t = await tenant('Detailing Co');
    const item = newId();
    const made = await app.inject({
      method: 'PUT',
      url: `/v1/items/${item}`,
      headers: { authorization: `Bearer ${t.adminToken}`, 'idempotency-key': newId() },
      payload: {
        code: `I-${newId().slice(-6)}`,
        name: 'Cough syrup 100 ML',
        productName: 'Cough syrup',
        categoryName: null,
        hsn: '3004',
        taxRate: '12',
        mrp: '95',
        packLabel: '100 ML',
        baseUnit: 'piece',
        units: [],
        measureType: null,
        measurePerBaseUnit: null,
      },
    });
    expect(made.statusCode, made.body).toBe(201);
    await publish(t, {
      key: 'detailing',
      accountLink: { mode: 'required', accountTypes: ['customer'] },
      visitSession: true,
      signature: 'optional',
      signatureRequiredWhen: { clauses: [{ field: 'samples', op: 'is_not_empty' }] },
      fields: [
        {
          key: 'products_detailed',
          type: 'product_lines',
          label: text('Products detailed'),
          required: true,
          quantities: false,
        },
        { key: 'samples', type: 'product_lines', label: text('Samples') },
        {
          key: 'no_order_reason',
          type: 'single_select',
          label: text('Why no order'),
          required: true,
          options: [{ key: 'stocked', label: text('Stocked up') }],
          visibleWhen: { clauses: [{ field: 'visit_ordered', op: 'eq', value: false }] },
        },
      ],
    });
    const shiftId = await punchIn(t.api.asha);
    const visit = checkIn(t.shop);
    await t.api.asha.post('/v1/visits', visit);
    const form = (values: object, extra: object = {}) => ({
      id: newId(),
      form: { key: 'detailing', version: 1 },
      visitId: visit.id,
      capturedAt: new Date().toISOString(),
      fix: fix(Date.now()),
      values,
      photos: [],
      ...extra,
    });

    // No order yet: the reason is asked for. Samples given: the doctor signs.
    const detailed = { products_detailed: [{ itemId: item }] };
    expect((await t.api.asha.post('/v1/submissions', form(detailed))).json().error.details).toEqual(
      [{ path: 'values.no_order_reason', issue: 'Fill this in' }],
    );
    const sampled = {
      ...detailed,
      samples: [{ itemId: item, quantity: 2 }],
      no_order_reason: 'stocked',
    };
    expect((await t.api.asha.post('/v1/submissions', form(sampled))).json().error.details).toEqual([
      { path: 'signature', issue: 'Ask for a signature' },
    ]);
    const signed = await t.api.asha.post(
      '/v1/submissions',
      form(sampled, { signature: { width: 300, height: 120, strokes: ['M10 60 L80 30'] } }),
    );
    expect(signed.statusCode, signed.body).toBe(201);
    expect(signed.json().values.products_detailed).toEqual([{ itemId: item, quantity: 1 }]);

    // Once the visit takes an order, nobody is asked why there wasn't one.
    await world.database.forTenant(t.tenantId, (tx) =>
      tx.execute(sql`
        insert into cell.orders (id, number, tenant_id, account_id, supplier_kind, user_id, visit_id, shift_id,
                                 placed_at, subtotal, tax_total, total)
        values (${newId()}, (select coalesce(max(number), 1000) + 1 from cell.orders where tenant_id = ${t.tenantId}), ${t.tenantId}, ${t.shop}, 'company', ${t.asha.id}, ${visit.id}, ${shiftId},
                now(), '0.00', '0.00', '0.00')`),
    );
    const ordered = await t.api.asha.post('/v1/submissions', form(detailed));
    expect(ordered.statusCode, ordered.body).toBe(201);
  });
});
