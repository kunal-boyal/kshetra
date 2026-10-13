import type { FormDefinition } from '@kshetra/forms';
import { beforeEach, describe, expect, it } from 'vitest';
import { EntryClosed, FormEntries } from './entries';
import { migrate } from './local-schema';
import { nodeSqlite } from './node-sqlite';
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
