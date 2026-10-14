import type { FormDefinition } from '@kshetra/forms';
import { beforeEach, describe, expect, it } from 'vitest';
import { EntryClosed, entryPhotos, FormEntries, signatureOf, submissionBody } from './entries';
import { migrate } from './local-schema';
import { nodeSqlite } from './node-sqlite';
import { Outbox } from './outbox';
import type { SqlDatabase } from './sql';

const ME = 'tenant-a:user-a';
const SOMEONE = 'tenant-a:user-b';
const ENTRY = '01a10000-0000-7000-8000-0000000000e1';
const OTHER = '01a10000-0000-7000-8000-0000000000e2';

const FORM: FormDefinition & { id: string; version: number; active: boolean } = {
  id: '01a10000-0000-7000-8000-0000000000f1',
  version: 3,
  active: true,
  key: 'shop_check',
  name: {
    en: { one: 'Shop check', other: 'Shop checks' },
    hi: { one: 'Shop check', other: 'Shop checks' },
  },
  icon: 'clipboard-list',
  tags: [],
  accountLink: { mode: 'none' },
  visitSession: false,
  shift: 'required',
  signature: 'optional',
  geofence: 'inherit',
  review: 'manual',
  fields: [
    {
      key: 'notes',
      type: 'long_text',
      label: { en: 'Notes', hi: 'Notes' },
      required: false,
      maxLength: 2000,
    },
  ],
};

let db: SqlDatabase;
let now: number;
let entries: FormEntries;

beforeEach(async () => {
  db = nodeSqlite();
  await migrate(db);
  now = Date.parse('2026-10-13T09:00:00Z');
  entries = new FormEntries(db, () => now);
});

describe('form entries (spec 5.6)', () => {
  it('keeps a draft on the version it was started on, and saves its changes', async () => {
    const started = await entries.start({ id: ENTRY, owner: ME, form: FORM });
    expect(started).toMatchObject({
      formKey: 'shop_check',
      formVersion: 3,
      state: 'draft',
      values: {},
      photos: [],
      signature: null,
    });
    expect(started.definition).not.toHaveProperty('id');
    expect(started.definition).not.toHaveProperty('version');
    now += 60_000;
    const saved = await entries.save(ME, ENTRY, {
      values: { notes: 'Shelf half empty' },
      photos: ['01a10000-0000-7000-8000-0000000000aa'],
      signature: ['M1 1 L5 5'],
    });
    expect(saved).toMatchObject({
      values: { notes: 'Shelf half empty' },
      photos: ['01a10000-0000-7000-8000-0000000000aa'],
      signature: ['M1 1 L5 5'],
      updatedAt: now,
    });
  });

  it("submits a draft, which no longer changes, and keeps one person's entries from another's", async () => {
    await entries.start({ id: ENTRY, owner: ME, form: FORM });
    await entries.start({ id: OTHER, owner: SOMEONE, form: FORM });
    now += 1_000;
    const queued = await entries.submit(ME, ENTRY, { values: { notes: 'Done' } });
    expect(queued).toMatchObject({ state: 'queued', submittedAt: now, values: { notes: 'Done' } });
    await expect(entries.save(ME, ENTRY, { values: {} })).rejects.toBeInstanceOf(EntryClosed);
    await expect(entries.discard(ME, ENTRY)).rejects.toBeInstanceOf(EntryClosed);
    await expect(entries.save(ME, OTHER, { values: {} })).rejects.toBeInstanceOf(EntryClosed);
    expect((await entries.list(ME)).map((entry) => entry.id)).toEqual([ENTRY]);
    expect(await entries.get(ME, OTHER)).toBeNull();
  });

  it('lists drafts newest first, then queued entries in the order they will go', async () => {
    const ids = ['e1', 'e2', 'e3', 'e4'].map(
      (suffix) => `01a10000-0000-7000-8000-0000000000${suffix}`,
    );
    for (const id of ids) {
      now += 1_000;
      await entries.start({ id, owner: ME, form: FORM });
    }
    now += 1_000;
    await entries.submit(ME, ids[2]!);
    now += 1_000;
    await entries.submit(ME, ids[0]!);
    expect((await entries.list(ME)).map((entry) => entry.id)).toEqual([
      ids[3],
      ids[1],
      ids[2],
      ids[0],
    ]);
    await entries.discard(ME, ids[3]!);
    expect(await entries.get(ME, ids[3]!)).toBeNull();
  });
});

describe('sending a submitted entry (M6)', () => {
  const FIX = {
    location: { lat: 28.6315, lng: 77.2167 },
    accuracy: 12,
    mocked: false,
    capturedAt: '2026-10-13T09:00:30.000Z',
  };
  const PHOTO = '01a10000-0000-7000-8000-0000000000aa';
  const FIELD_PHOTO = '01a10000-0000-7000-8000-0000000000ab';
  const VISIT = '01a10000-0000-7000-8000-0000000000d1';
  const WITH_PHOTO: typeof FORM = {
    ...FORM,
    fields: [
      ...FORM.fields,
      {
        key: 'shelf',
        type: 'photo',
        label: { en: 'Shelf', hi: 'Shelf' },
        required: false,
        source: 'camera',
      },
    ],
  };

  it('keeps when, where and in which visit, and queues the upload in the same transaction', async () => {
    const outbox = new Outbox(db, {});
    await entries.start({ id: ENTRY, owner: ME, form: WITH_PHOTO });
    now += 60_000;
    const capture = { capturedAt: now - 30_000, fix: FIX, visitId: VISIT };
    const queued = await entries.submit(
      ME,
      ENTRY,
      {
        values: { notes: 'Done', shelf: FIELD_PHOTO },
        photos: [PHOTO],
        signature: ['M10 20 L200 90'],
      },
      capture,
      (tx, entry) =>
        outbox.enqueue(tx, {
          id: entry.id,
          owner: ME,
          kind: 'submission.create',
          payload: submissionBody(entry),
          dependsOn: [...entryPhotos(entry), VISIT],
        }),
    );
    expect(queued).toMatchObject({
      state: 'queued',
      visitId: VISIT,
      capturedAt: now - 30_000,
      fix: FIX,
    });
    const [item] = await outbox.items(ME);
    expect(item).toMatchObject({
      id: ENTRY,
      kind: 'submission.create',
      dependsOn: [PHOTO, FIELD_PHOTO, VISIT],
      payload: {
        id: ENTRY,
        form: { key: 'shop_check', version: 3 },
        visitId: VISIT,
        capturedAt: new Date(now - 30_000).toISOString(),
        fix: FIX,
        values: { notes: 'Done', shelf: FIELD_PHOTO },
        photos: [PHOTO],
        signature: { width: 208, height: 98, strokes: ['M10 20 L200 90'] },
      },
    });
  });

  it('queues nothing when the upload fails to queue, and never sends an entry without a capture', async () => {
    await entries.start({ id: ENTRY, owner: ME, form: FORM });
    await expect(
      entries.submit(ME, ENTRY, {}, { capturedAt: now, fix: FIX, visitId: null }, async () => {
        throw new Error('The outbox is full.');
      }),
    ).rejects.toThrow('The outbox is full.');
    expect(await entries.get(ME, ENTRY)).toMatchObject({ state: 'draft', fix: null });
    const draft = (await entries.get(ME, ENTRY))!;
    expect(() => submissionBody(draft)).toThrow();
  });

  it('sizes a signature by its strokes, within what the server takes', () => {
    expect(signatureOf(['M1 1 L5 5'])).toEqual({ width: 50, height: 50, strokes: ['M1 1 L5 5'] });
    expect(signatureOf(['M10 20 L9000 30'])).toMatchObject({ width: 4000, height: 50 });
  });
});
