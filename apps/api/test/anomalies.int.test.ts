import { createHash } from 'node:crypto';
import { type FlagNotes, newId } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Anomalies } from '../src/modules/field/anomalies';
import { ShiftsService } from '../src/modules/field/shifts.service';
import { type MemoryObjectStore, ObjectStore } from '../src/platform/object-store';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Anomaly flags on evidence (BR-50, decision D119): flags for reviewers, never refusals. */

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

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
/** Connaught Place, New Delhi; `north(m)` is that many metres north of it. */
const HERE = { lat: 28.6315, lng: 77.2167 };
const north = (metres: number) => ({ lat: HERE.lat + metres / 111_195, lng: HERE.lng });

function as(token: string) {
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, key = newId()) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object, key?: string) => call('POST', url, payload, key),
    patch: (url: string, payload: object) => call('PATCH', url, payload),
  };
}
type Api = ReturnType<typeof as>;

const noun = (word: string) => ({
  en: { one: word, other: `${word}s` },
  hi: { one: word, other: word },
});

/**
 * A tenant with its admin on the web and three people on phones, each on a shift that began two
 * hours ago, and Mohan on a phone with no shift; a form reviewed by a person that takes photos
 * and may be filled off shift.
 */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { admin: newPhone(), asha: newPhone(), ravi: newPhone(), mohan: newPhone() };
  const admin = await world.user(tenantId, {
    phone: phones.admin,
    designation: 'head',
    role: 'tenant_admin',
  });
  const people = {
    asha: await world.user(tenantId, {
      phone: phones.asha,
      designation: 'executive',
      managerId: admin.id,
    }),
    ravi: await world.user(tenantId, {
      phone: phones.ravi,
      designation: 'executive',
      managerId: admin.id,
    }),
    mohan: await world.user(tenantId, {
      phone: phones.mohan,
      designation: 'executive',
      managerId: admin.id,
    }),
  };
  const api = {
    admin: as((await world.signIn(phones.admin)).accessToken),
    asha: as((await world.signIn(phones.asha, newDevice())).accessToken),
    ravi: as((await world.signIn(phones.ravi, newDevice())).accessToken),
    mohan: as((await world.signIn(phones.mohan, newDevice())).accessToken),
  };
  const made = await api.admin.post('/v1/forms', {
    definition: {
      key: 'note',
      name: noun('note'),
      icon: 'notebook-pen',
      review: 'manual',
      shift: 'allowed_off_shift',
      photos: { min: 0, max: 3 },
      fields: [{ key: 'text', type: 'short_text', label: { en: 'Text', hi: 'Text' } }],
    },
  });
  expect(made.statusCode, made.body).toBe(201);
  for (const who of [api.asha, api.ravi]) {
    const shift = await who.post('/v1/shifts', {
      id: newId(),
      startedAt: new Date(Date.now() - 2 * H).toISOString(),
      location: HERE,
      accuracy: 15,
      mocked: false,
      consentVersion: '2026-10',
    });
    expect(shift.statusCode, shift.body).toBe(201);
  }
  return { tenantId, admin, people, api };
}
type Tenant = Awaited<ReturnType<typeof tenant>>;

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

/** A camera photo taken at a place, its fix mocked or not. */
async function photo(api: Api, at: number, where = HERE, mocked = false) {
  const id = newId();
  const bytes = await jpeg(Math.random() * 6);
  const presigned = await api.post('/v1/media/presign', {
    id,
    kind: 'evidence',
    contentType: 'image/jpeg',
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  expect(presigned.statusCode, presigned.body).toBe(200);
  store.receive(presigned.json().upload.url, bytes);
  const when = new Date(at).toISOString();
  const confirmed = await api.post(`/v1/media/${id}/confirm`, {
    capturedAt: when,
    source: 'camera',
    fix: { ...where, accuracy: 12, capturedAt: when, mocked },
  });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  return id;
}

/** Fills the form on a phone at a moment and place; returns the submission's ID. */
async function submit(
  api: Api,
  options: { at?: number; where?: { lat: number; lng: number }; photos?: string[] } = {},
) {
  const id = newId();
  const at = new Date(options.at ?? Date.now()).toISOString();
  const sent = await api.post('/v1/submissions', {
    id,
    form: { key: 'note', version: 1 },
    capturedAt: at,
    fix: { location: options.where ?? HERE, accuracy: 12, mocked: false, capturedAt: at },
    values: { text: 'All well' },
    photos: options.photos ?? [],
  });
  expect(sent.statusCode, sent.body).toBe(201);
  return id;
}

/** A person's submissions as the admin reads them: flags and notes by ID. */
async function flagsOf(t: Tenant, userId: string) {
  const list = await t.api.admin.get(`/v1/submissions?userId=${userId}`);
  expect(list.statusCode, list.body).toBe(200);
  const items = list.json().items as { id: string; flags: string[]; flagNotes: FlagNotes }[];
  return new Map(items.map((item) => [item.id, item]));
}

describe('anomaly flags on evidence (BR-50, decision D119)', () => {
  it('flags a far photo and a mocked one, explaining each without a place', async () => {
    const t = await tenant('Far Photo Co');
    const at = Date.now() - 10 * MIN;
    const far = await photo(t.api.asha, at, north(300));
    const faked = await photo(t.api.asha, at, HERE, true);
    const near = await photo(t.api.asha, at, north(100));
    const id = await submit(t.api.asha, { at, photos: [far, faked, near] });

    const found = (await flagsOf(t, t.people.asha.id)).get(id)!;
    expect(found.flags).toEqual(expect.arrayContaining(['photo_far', 'mock_history']));
    expect(found.flags).not.toContain('off_shift');
    expect(found.flagNotes).toEqual({
      photo_far: { photoId: far, distanceM: 300 },
      mock_history: { source: 'photo', lastSeenAt: null },
    });
    expect(JSON.stringify(found.flagNotes)).not.toContain(String(HERE.lng));
  });

  it('flags travel faster than the road allows, both ways, however the records arrive', async () => {
    const t = await tenant('Fast Travel Co');
    const now = Date.now();
    // The later record arrives first; the earlier one, 20 km away 5 minutes before, after it.
    const later = await submit(t.api.asha, { at: now - 10 * MIN });
    const earlier = await submit(t.api.asha, { at: now - 15 * MIN, where: north(20_000) });

    const found = await flagsOf(t, t.people.asha.id);
    expect(found.get(earlier)!.flags).toContain('fast_travel');
    expect(found.get(later)!.flags).toContain('fast_travel');
    expect(found.get(later)!.flagNotes.fast_travel).toMatchObject({
      otherKind: 'submission',
      otherId: earlier,
      distanceM: 20_000,
      seconds: 300,
    });
    expect(found.get(earlier)!.flagNotes.fast_travel).toMatchObject({ otherId: later });

    // The punch-in two hours before, at HERE, counts as a record too.
    expect(found.get(earlier)!.flags).not.toContain('burst');
  });

  it('leaves GPS drift alone: under 5 km apart, however close in time', async () => {
    const t = await tenant('Drift Co');
    const now = Date.now();
    const one = await submit(t.api.ravi, { at: now - 10 * MIN });
    const two = await submit(t.api.ravi, { at: now - 9 * MIN, where: north(4_900) });
    const found = await flagsOf(t, t.people.ravi.id);
    expect(found.get(one)!.flags).toEqual([]);
    expect(found.get(two)!.flags).toEqual([]);
  });

  it('flags a burst of records at different places, and every waiting one in it', async () => {
    const t = await tenant('Burst Co');
    const now = Date.now();
    const ids = [
      await submit(t.api.ravi, { at: now - 20 * MIN }),
      await submit(t.api.ravi, { at: now - 17 * MIN, where: north(400) }),
      await submit(t.api.ravi, { at: now - 14 * MIN, where: north(800) }),
    ];
    const found = await flagsOf(t, t.people.ravi.id);
    for (const id of ids) expect(found.get(id)!.flags).toContain('burst');
    expect(found.get(ids[2]!)!.flagNotes.burst).toEqual({ places: 3, seconds: 360 });
  });

  it('flags capture off shift, and stops judging a check the tenant switched off', async () => {
    const t = await tenant('Off Shift Co');
    const first = await submit(t.api.mohan, { at: Date.now() - 30 * MIN });
    expect((await flagsOf(t, t.people.mohan.id)).get(first)!.flags).toEqual(['off_shift']);

    const off = await t.api.admin.patch('/v1/settings', { anomalyFlagsOff: ['off_shift'] });
    expect(off.statusCode, off.body).toBe(200);
    const second = await submit(t.api.mohan, { at: Date.now() - 5 * MIN });
    const found = await flagsOf(t, t.people.mohan.id);
    expect(found.get(second)!.flags).toEqual([]);
    // A flag already given stays.
    expect(found.get(first)!.flags).toEqual(['off_shift']);
  });

  it('keeps the phone’s reports of mocked fixes, flagging waiting records after them', async () => {
    const t = await tenant('Mock Report Co');
    const now = Date.now();
    const decided = await submit(t.api.asha, { at: now - 40 * MIN, where: north(-1_000) });
    const waiting = await submit(t.api.asha, { at: now - 30 * MIN });
    const before = await submit(t.api.asha, { at: now - 80 * MIN, where: north(-3_000) });
    const approved = await t.api.admin.post(`/v1/submissions/${decided}/review`, {
      decision: 'approved',
    });
    expect(approved.statusCode, approved.body).toBe(200);

    const report = {
      id: newId(),
      seenAt: new Date(now - 50 * MIN).toISOString(),
      source: 'form',
      count: 2,
    };
    const sent = await t.api.asha.post('/v1/locations/mocked', report);
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json()).toEqual(report);
    // A resend replays; the same ID with something else changed is refused.
    expect((await t.api.asha.post('/v1/locations/mocked', report)).statusCode).toBe(201);
    const changed = await t.api.asha.post('/v1/locations/mocked', { ...report, count: 3 });
    expect(changed.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    // Nothing from the future or past the sync window; and only from a phone.
    const future = await t.api.asha.post('/v1/locations/mocked', {
      ...report,
      id: newId(),
      seenAt: new Date(now + 10 * MIN).toISOString(),
    });
    expect(future.json().error.details).toEqual([
      { path: 'seenAt', issue: 'This time is in the future' },
    ]);
    const old = await t.api.asha.post('/v1/locations/mocked', {
      ...report,
      id: newId(),
      seenAt: new Date(now - 4 * DAY).toISOString(),
    });
    expect(old.json().error.code).toBe('SYNC_WINDOW');
    expect(
      (await t.api.admin.post('/v1/locations/mocked', { ...report, id: newId() })).json().error
        .code,
    ).toBe('USE_MOBILE_APP');

    let found = await flagsOf(t, t.people.asha.id);
    expect(found.get(waiting)!.flags).toContain('mock_history');
    expect(found.get(waiting)!.flagNotes.mock_history).toEqual({
      source: 'form',
      lastSeenAt: report.seenAt,
    });
    expect(found.get(decided)!.flags).not.toContain('mock_history');
    expect(found.get(before)!.flags).not.toContain('mock_history');

    // A record made after the report is flagged as it arrives.
    const after = await submit(t.api.asha, { at: now - 5 * MIN });
    found = await flagsOf(t, t.people.asha.id);
    expect(found.get(after)!.flagNotes.mock_history).toEqual({
      source: 'form',
      lastSeenAt: report.seenAt,
    });

    // Reports go after 90 days, and with the person when they are erased.
    const count = () =>
      world.database.forTenant(t.tenantId, async (tx) => {
        const rows = await tx.execute(
          sql`select count(*)::int as n from cell.mock_location_reports where tenant_id = ${t.tenantId}`,
        );
        return (rows.rows[0] as { n: number }).n;
      });
    expect(await count()).toBe(1);
    const anomalies = app.get(Anomalies);
    await world.database.forTenant(t.tenantId, (tx) =>
      anomalies.purge(tx, t.tenantId, new Date(now + 89 * DAY)),
    );
    expect(await count()).toBe(1);
    await world.database.forTenant(t.tenantId, (tx) =>
      anomalies.purge(tx, t.tenantId, new Date(now + 91 * DAY)),
    );
    expect(await count()).toBe(0);
    const again = await t.api.asha.post('/v1/locations/mocked', { ...report, id: newId() });
    expect(again.statusCode, again.body).toBe(201);
    await world.database.forTenant(t.tenantId, (tx) =>
      app.get(ShiftsService).erasePerson(tx, t.tenantId, t.people.asha.id),
    );
    expect(await count()).toBe(0);
  });
});
