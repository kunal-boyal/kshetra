import { createHash } from 'node:crypto';
import { newId } from '@kshetra/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PhotosService } from '../src/modules/media/photos.service';
import { type MemoryObjectStore, ObjectStore } from '../src/platform/object-store';
import { Queues } from '../src/platform/queues';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Photos (spec 12.2, BR-40): presigned uploads, processing, duplicates and signed reads. */

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

/** A photo of a scene: stripes whose angle and colours make each scene its own. */
async function jpeg(scene: number, quality = 80, brightness = 1): Promise<Uint8Array> {
  const width = 640;
  const height = 480;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const band = Math.floor((x * Math.cos(scene) + y * Math.sin(scene)) / 40) % 2;
      const shade = band ? 40 + scene * 20 : 200 - scene * 10;
      const i = (y * width + x) * 3;
      pixels[i] = shade;
      pixels[i + 1] = (shade + x / 4) % 256;
      pixels[i + 2] = (shade + y / 4) % 256;
    }
  }
  return new Uint8Array(
    await sharp(pixels, { raw: { width, height, channels: 3 } })
      .modulate({ brightness })
      .jpeg({ quality })
      .toBuffer(),
  );
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A team: a manager, two people reporting to them, each signed in. */
async function team(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { manager: newPhone(), asha: newPhone(), ravi: newPhone() };
  const manager = await world.user(tenantId, { phone: phones.manager, designation: 'manager' });
  const asha = await world.user(tenantId, {
    phone: phones.asha,
    designation: 'executive',
    managerId: manager.id,
  });
  const ravi = await world.user(tenantId, {
    phone: phones.ravi,
    designation: 'executive',
    managerId: manager.id,
  });
  // Executives work on phones only, so they sign in on one.
  const token = async (phone: string, device?: ReturnType<typeof newDevice>) =>
    (await world.signIn(phone, device)).accessToken;
  return {
    tenantId,
    asha,
    ravi,
    api: {
      manager: as(await token(phones.manager)),
      asha: as(await token(phones.asha, newDevice())),
      ravi: as(await token(phones.ravi, newDevice())),
    },
  };
}

type Team = Awaited<ReturnType<typeof team>>;

/** What the phone does: register, upload straight to storage, confirm. */
async function upload(
  api: Team['api']['asha'],
  bytes: Uint8Array,
  kind = 'evidence',
  id = newId(),
) {
  const presigned = await api.post('/v1/media/presign', {
    id,
    kind,
    contentType: 'image/jpeg',
    size: bytes.byteLength,
    sha256: sha(bytes),
  });
  expect(presigned.statusCode).toBe(200);
  const { upload: link } = presigned.json();
  if (link) store.receive(link.url, bytes);
  const confirmed = await api.post(`/v1/media/${id}/confirm`, {
    capturedAt: new Date().toISOString(),
    source: 'camera',
    fix: { lat: 28.6315, lng: 77.2167, accuracy: 12, capturedAt: new Date().toISOString() },
  });
  expect(confirmed.statusCode).toBe(200);
  return id;
}

const process = (t: Team, id: string) => app.get(PhotosService).process(t.tenantId, id);
const result = (t: Team, id: string) =>
  world.database.forTenant(t.tenantId, (tx) => app.get(PhotosService).result(tx, t.tenantId, id));

describe('uploading a photo (spec 12.2)', () => {
  it('takes only the bytes signed for, then thumbnails and stamps it beside the original', async () => {
    const t = await team('Photo Farms');
    const bytes = await jpeg(1);
    const id = newId();
    const presigned = (
      await t.api.asha.post('/v1/media/presign', {
        id,
        kind: 'evidence',
        contentType: 'image/jpeg',
        size: bytes.byteLength,
        sha256: sha(bytes),
      })
    ).json();
    expect(presigned).toMatchObject({
      status: 'pending',
      upload: {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.byteLength) },
      },
    });
    // Confirming before the bytes arrive waits for them.
    const early = await t.api.asha.post(`/v1/media/${id}/confirm`, {
      capturedAt: new Date().toISOString(),
      source: 'camera',
    });
    expect(early.json().error.code).toBe('MEDIA_NOT_READY');
    // Storage refuses altered bytes.
    const altered = Uint8Array.from(bytes);
    altered[100] = altered[100]! ^ 0xff;
    expect(() => store.receive(presigned.upload.url, altered)).toThrow();
    // A changed file under the same ID is another file.
    const reused = await t.api.asha.post('/v1/media/presign', {
      id,
      kind: 'evidence',
      contentType: 'image/jpeg',
      size: bytes.byteLength,
      sha256: sha(altered),
    });
    expect(reused.json().error.code).toBe('IDEMPOTENCY_CONFLICT');

    await upload(t.api.asha, bytes, 'evidence', id);
    // A retried registration after the upload skips it.
    const again = await t.api.asha.post('/v1/media/presign', {
      id,
      kind: 'evidence',
      contentType: 'image/jpeg',
      size: bytes.byteLength,
      sha256: sha(bytes),
    });
    expect(again.json()).toMatchObject({ status: 'uploaded', upload: null });

    await process(t, id);
    await process(t, id);
    expect(await result(t, id)).toMatchObject({
      status: 'processed',
      source: 'camera',
      point: { lat: 28.6315, lng: 77.2167 },
      accuracy: 12,
      duplicateOfId: null,
    });
    const link = (await t.api.asha.get(`/v1/media/${id}/url?variant=stamped`)).json();
    expect(link.url).toMatch(/stamped\.jpg/);
    const stamped = await sharp(
      Buffer.from(await store.get(new URL(link.url).pathname.slice(1))),
    ).metadata();
    expect(stamped).toMatchObject({ format: 'jpeg', width: 640 });
    expect(stamped.height).toBeGreaterThan(480);
    const thumbnail = (await t.api.asha.get(`/v1/media/${id}/url?variant=thumbnail`)).json();
    const small = await sharp(
      Buffer.from(await store.get(new URL(thumbnail.url).pathname.slice(1))),
    ).metadata();
    expect(Math.max(small.width!, small.height!)).toBe(320);
  });

  it('rejects what is not a JPEG, and never makes its variants', async () => {
    const t = await team('Photo Rejects');
    const png = new Uint8Array(
      await sharp(Buffer.from(await jpeg(2)))
        .png()
        .toBuffer(),
    );
    const id = await upload(t.api.asha, png);
    await process(t, id);
    expect(await result(t, id)).toMatchObject({
      status: 'rejected',
      rejectReason: 'This is not a JPEG photo.',
    });
    const link = await t.api.asha.get(`/v1/media/${id}/url?variant=stamped`);
    expect(link.json().error.code).toBe('MEDIA_NOT_READY');
  });
});

describe('duplicates (BR-40)', () => {
  it('flags the same bytes and the same scene, never a different one', async () => {
    const t = await team('Photo Duplicates');
    const first = await upload(t.api.asha, await jpeg(3));
    await process(t, first);

    const copy = await upload(t.api.ravi, await jpeg(3));
    // The same scene, saved again lighter and at another quality.
    const resaved = await upload(t.api.ravi, await jpeg(3, 60, 1.15));
    const other = await upload(t.api.ravi, await jpeg(7));
    for (const id of [copy, resaved, other]) await process(t, id);

    expect((await result(t, copy)).duplicateOfId).toBe(first);
    expect((await result(t, resaved)).duplicateOfId).toBe(first);
    expect(await result(t, other)).toMatchObject({ status: 'processed', duplicateOfId: null });
  });
});

describe('reading photos', () => {
  it('gives links to whoever took it and those whose scope reaches them, nobody else', async () => {
    const t = await team('Photo Readers');
    const id = await upload(t.api.asha, await jpeg(4));
    await process(t, id);
    expect((await t.api.asha.get(`/v1/media/${id}/url`)).statusCode).toBe(200);
    expect((await t.api.manager.get(`/v1/media/${id}/url?variant=original`)).statusCode).toBe(200);
    expect((await t.api.ravi.get(`/v1/media/${id}/url`)).json().error.code).toBe('OUT_OF_SCOPE');
    // Only the person who took it confirms it.
    const theirs = await t.api.ravi.post(`/v1/media/${id}/confirm`, {
      capturedAt: new Date().toISOString(),
      source: 'camera',
    });
    expect(theirs.json().error.code).toBe('OUT_OF_SCOPE');
  });
});

describe('the media worker', () => {
  it('processes a photo once it is confirmed', async () => {
    const t = await team('Photo Worker');
    app.get(Queues).startWorkers();
    const id = await upload(t.api.asha, await jpeg(5));
    const deadline = Date.now() + 15_000;
    let status = '';
    while (Date.now() < deadline && status !== 'processed') {
      status = (await result(t, id)).status;
      if (status !== 'processed') await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(status).toBe('processed');
  });
});
