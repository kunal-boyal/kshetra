import type { FormDefinition } from '@kshetra/forms';
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
  };
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
   * Submits a draft on the phone: its last changes and the move to queued happen together, and
   * from then on it is read only. Checking its values is the caller's, before this.
   */
  async submit(owner: string, id: string, changes: EntryChanges = {}): Promise<FormEntry> {
    await this.db.transaction(async (tx) => {
      await this.write(tx, owner, id, changes);
      await tx.run(
        `UPDATE form_entries SET state = 'queued', submitted_at = ? WHERE id = ? AND owner = ?`,
        [this.clock(), id, owner],
      );
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
