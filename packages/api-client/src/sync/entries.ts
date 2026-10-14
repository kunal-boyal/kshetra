import { type FormDefinition, photosIn } from '@kshetra/forms';
import type { CaptureFix, CreateSubmissionBody, Signature } from '@kshetra/shared';
import type { SqlDatabase, SqlExecutor, SqlValue } from './sql';

/**
 * A form being filled on the phone (spec 5.6, 8.1): a draft until it is submitted, then queued
 * until it is sent. It keeps the form version it was started on, so a newer version published
 * meanwhile neither changes nor loses it. A queued entry no longer changes (spec 5.6: a submitted
 * record is immutable).
 */
export interface FormEntry {
  id: string;
  owner: string;
  formKey: string;
  formVersion: number;
  definition: FormDefinition;
  accountId: string | null;
  values: Record<string, unknown>;
  /** The form's own photos, by media ID, besides any photo fields. */
  photos: string[];
  /** The signature as SVG path data, one path a stroke, or null for none. */
  signature: string[] | null;
  state: 'draft' | 'queued';
  startedAt: number;
  updatedAt: number;
  submittedAt: number | null;
  /** Set when it is submitted: the visit it was made in, and when and where (M6). */
  visitId: string | null;
  capturedAt: number | null;
  fix: CaptureFix | null;
}

/** When, where and in which visit an entry was submitted on the phone (M6, BR-32). */
export interface EntryCapture {
  capturedAt: number;
  fix: CaptureFix;
  visitId: string | null;
}

/** What a draft holds that the person changes. */
export type EntryChanges = Partial<
  Pick<FormEntry, 'accountId' | 'values' | 'photos' | 'signature'>
>;

interface EntryRecord {
  id: string;
  owner: string;
  form_key: string;
  form_version: number;
  definition: string;
  account_id: string | null;
  data: string;
  photos: string;
  signature: string | null;
  state: 'draft' | 'queued';
  started_at: number;
  updated_at: number;
  submitted_at: number | null;
  visit_id: string | null;
  captured_at: number | null;
  fix: string | null;
}

function toEntry(record: EntryRecord): FormEntry {
  return {
    id: record.id,
    owner: record.owner,
    formKey: record.form_key,
    formVersion: record.form_version,
    definition: JSON.parse(record.definition) as FormDefinition,
    accountId: record.account_id,
    values: JSON.parse(record.data) as Record<string, unknown>,
    photos: JSON.parse(record.photos) as string[],
    signature: record.signature === null ? null : (JSON.parse(record.signature) as string[]),
    state: record.state,
    startedAt: record.started_at,
    updatedAt: record.updated_at,
    submittedAt: record.submitted_at,
    visitId: record.visit_id,
    capturedAt: record.captured_at,
    fix: record.fix === null ? null : (JSON.parse(record.fix) as CaptureFix),
  };
}

/** The pad a signature was drawn on, from its strokes: up to its furthest point, with a margin. */
export function signatureOf(strokes: readonly string[]): Signature {
  let width = 0;
  let height = 0;
  for (const stroke of strokes) {
    const numbers = (stroke.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    for (let index = 0; index + 1 < numbers.length; index += 2) {
      width = Math.max(width, numbers[index]!);
      height = Math.max(height, numbers[index + 1]!);
    }
  }
  const size = (value: number) => Math.min(4000, Math.max(50, Math.ceil(value) + 8));
  return { width: size(width), height: size(height), strokes: [...strokes] };
}

/**
 * What a submitted entry sends (`POST /v1/submissions`): its own ID, the version it was filled
 * on, when and where it was captured, and its photos and signature.
 */
export function submissionBody(entry: FormEntry): CreateSubmissionBody {
  if (entry.capturedAt === null || !entry.fix) {
    throw new Error(`Form entry ${entry.id} was not captured.`);
  }
  return {
    id: entry.id,
    form: { key: entry.formKey, version: entry.formVersion },
    ...(entry.accountId ? { accountId: entry.accountId } : {}),
    ...(entry.visitId ? { visitId: entry.visitId } : {}),
    capturedAt: new Date(entry.capturedAt).toISOString(),
    fix: entry.fix,
    values: entry.values,
    photos: entry.photos,
    ...(entry.signature && entry.signature.length > 0
      ? { signature: signatureOf(entry.signature) }
      : {}),
  };
}

/** Every photo an entry sends, the form's and its photo fields', which must upload first. */
export function entryPhotos(entry: FormEntry): string[] {
  return [...entry.photos, ...photosIn(entry.definition, entry.values).map((photo) => photo.id)];
}

/** Thrown when a change reaches an entry that is queued, gone, or someone else's. */
export class EntryClosed extends Error {
  constructor(id: string) {
    super(`Form entry ${id} can't change now.`);
    this.name = 'EntryClosed';
  }
}

/** The phone's form entries, each person's apart from everyone else's on the same phone. */
export class FormEntries {
  constructor(
    private readonly db: SqlDatabase,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Starts a draft of a form's current version. */
  async start(entry: {
    id: string;
    owner: string;
    form: FormDefinition & { version: number };
    accountId?: string | null;
    values?: Record<string, unknown>;
  }): Promise<FormEntry> {
    const now = this.clock();
    const { version, ...definition } = entry.form;
    // Only the definition is kept: what makes it a version is its number.
    const kept: Record<string, unknown> = { ...definition };
    delete kept.id;
    delete kept.active;
    await this.db.run(
      `INSERT INTO form_entries
         (id, owner, form_key, form_version, definition, account_id, data, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.owner,
        definition.key,
        version,
        JSON.stringify(kept),
        entry.accountId ?? null,
        JSON.stringify(entry.values ?? {}),
        now,
        now,
      ],
    );
    return (await this.get(entry.owner, entry.id))!;
  }

  async get(owner: string, id: string): Promise<FormEntry | null> {
    const record = await this.db.get<EntryRecord>(
      'SELECT * FROM form_entries WHERE id = ? AND owner = ?',
      [id, owner],
    );
    return record ? toEntry(record) : null;
  }

  /** Drafts first, newest first, then queued entries, oldest first, as they will be sent. */
  async list(owner: string): Promise<FormEntry[]> {
    const records = await this.db.all<EntryRecord>(
      `SELECT * FROM form_entries WHERE owner = ?
        ORDER BY state = 'queued', CASE state WHEN 'draft' THEN -updated_at ELSE submitted_at END`,
      [owner],
    );
    return records.map(toEntry);
  }

  /** Saves what changed in a draft. */
  async save(owner: string, id: string, changes: EntryChanges): Promise<FormEntry> {
    await this.db.transaction((tx) => this.write(tx, owner, id, changes));
    return (await this.get(owner, id))!;
  }

  /**
   * Submits a draft on the phone: its last changes, when and where it was captured, and the move
   * to queued happen together, with `also` (such as queueing its upload) in the same
   * transaction; from then on it is read only. Checking its values is the caller's, before this.
   */
  async submit(
    owner: string,
    id: string,
    changes: EntryChanges = {},
    capture?: EntryCapture,
    also?: (tx: SqlExecutor, entry: FormEntry) => Promise<void>,
  ): Promise<FormEntry> {
    await this.db.transaction(async (tx) => {
      await this.write(tx, owner, id, changes);
      await tx.run(
        `UPDATE form_entries SET state = 'queued', submitted_at = ?, visit_id = ?,
                                 captured_at = ?, fix = ?
          WHERE id = ? AND owner = ?`,
        [
          this.clock(),
          capture?.visitId ?? null,
          capture?.capturedAt ?? null,
          capture ? JSON.stringify(capture.fix) : null,
          id,
          owner,
        ],
      );
      if (also) {
        const record = await tx.get<EntryRecord>(
          'SELECT * FROM form_entries WHERE id = ? AND owner = ?',
          [id, owner],
        );
        await also(tx, toEntry(record!));
      }
    });
    return (await this.get(owner, id))!;
  }

  /** Drops a draft for good; the screen asks first. A queued entry can't be dropped. */
  async discard(owner: string, id: string): Promise<void> {
    const found = await this.db.get<{ state: string }>(
      'SELECT state FROM form_entries WHERE id = ? AND owner = ?',
      [id, owner],
    );
    if (!found || found.state !== 'draft') throw new EntryClosed(id);
    await this.db.run(`DELETE FROM form_entries WHERE id = ? AND owner = ?`, [id, owner]);
  }

  private async write(
    tx: SqlExecutor,
    owner: string,
    id: string,
    changes: EntryChanges,
  ): Promise<void> {
    const found = await tx.get<{ state: string }>(
      'SELECT state FROM form_entries WHERE id = ? AND owner = ?',
      [id, owner],
    );
    if (!found || found.state !== 'draft') throw new EntryClosed(id);
    const columns: Record<string, SqlValue> = { updated_at: this.clock() };
    if (changes.accountId !== undefined) columns.account_id = changes.accountId;
    if (changes.values !== undefined) columns.data = JSON.stringify(changes.values);
    if (changes.photos !== undefined) columns.photos = JSON.stringify(changes.photos);
    if (changes.signature !== undefined) {
      columns.signature = changes.signature === null ? null : JSON.stringify(changes.signature);
    }
    const names = Object.keys(columns);
    await tx.run(
      `UPDATE form_entries SET ${names.map((name) => `${name} = ?`).join(', ')}
        WHERE id = ? AND owner = ?`,
      [...Object.values(columns), id, owner],
    );
  }
}
