import { ApiError, NetworkError } from '../client';
import type { SqlDatabase, SqlExecutor, SqlValue } from './sql';

/** One record waiting to upload (spec 11.3). */
export interface OutboxItem {
  seq: number;
  /** The record's client-generated ID, which also makes its upload idempotent (BR-46). */
  id: string;
  /** `tenant:user`: only the same person, signed in to the same tenant, sends it. */
  owner: string;
  kind: string;
  payload: unknown;
  /** Items that must upload first, such as the photos a visit refers to. */
  dependsOn: string[];
  attempts: number;
  /** Not before this, in milliseconds since the epoch; null for now. */
  nextAttemptAt: number | null;
  lastError: string | null;
  /** The error code of the last failure, from spec 11.4, or one of the outbox's own. */
  lastErrorCode: string | null;
  state: 'queued' | 'parked';
  createdAt: number;
}

/** How one kind of record uploads. */
export interface OutboxSender {
  send(payload: unknown, item: OutboxItem): Promise<void>;
  /** Cleans up after a discarded item, such as deleting its photo file. */
  discard?(payload: unknown): Promise<void>;
}

/** The outbox's own codes for parked items, beside the API's. */
export const OUTBOX_CODES = {
  /** No sender for the item's kind: an app version that no longer knows it. */
  unknownKind: 'UNKNOWN_KIND',
  /** Something the item needed was discarded, so it can't upload as it is. */
  dependencyDiscarded: 'DEPENDENCY_DISCARDED',
} as const;

export interface OutboxCounts {
  queued: number;
  parked: number;
  /** When the oldest unsent item was saved, or null when none is. */
  oldestAt: number | null;
}

export type RunResult =
  /** Nothing left that can upload now. */
  | { status: 'done' }
  /** A transient failure, or a backoff: the next item may go at `until`. */
  | { status: 'waiting'; until: number; error?: unknown }
  /** Signed out, or the app must update: nothing more until that changes. */
  | { status: 'stopped'; error: unknown };

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 15 * 60_000;

/** `min(15 min, 5 s × 2^attempts)` (spec 11.3). */
export function backoff(attempts: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(attempts, 20));
}

type Failure = 'transient' | 'permanent' | 'stop';

/**
 * Transient: no network, 5xx, 429, a tenant that is read-only or suspended for now, or media
 * the server hasn't got yet. Stop: a 401 the client couldn't refresh, or an app too old. Any
 * other 4xx is permanent, and the item parks with the server's message (spec 11.3, 11.4).
 */
function classify(error: unknown): Failure {
  if (error instanceof NetworkError) return 'transient';
  if (!(error instanceof ApiError)) return 'permanent';
  if (error.status >= 500 || error.status === 429 || error.status === 423) return 'transient';
  if (error.code === 'MEDIA_NOT_READY') return 'transient';
  if (error.status === 401 || error.code === 'UPGRADE_REQUIRED') return 'stop';
  return 'permanent';
}

interface OutboxRecord {
  seq: number;
  id: string;
  owner: string;
  kind: string;
  payload: string;
  depends_on: string;
  attempts: number;
  next_attempt_at: number | null;
  last_error: string | null;
  last_error_code: string | null;
  state: 'queued' | 'parked';
  created_at: number;
}

function toItem(record: OutboxRecord): OutboxItem {
  return {
    seq: record.seq,
    id: record.id,
    owner: record.owner,
    kind: record.kind,
    payload: JSON.parse(record.payload) as unknown,
    dependsOn: JSON.parse(record.depends_on) as string[],
    attempts: record.attempts,
    nextAttemptAt: record.next_attempt_at,
    lastError: record.last_error,
    lastErrorCode: record.last_error_code,
    state: record.state,
    createdAt: record.created_at,
  };
}

/**
 * The push side of the sync (spec 11.3). Captures write their records here in the same local
 * transaction as everything else they save. One run at a time uploads the oldest queued item whose
 * dependencies have gone, removes it on success, and on a transient failure backs off and ends,
 * so order is kept. A permanent failure parks the item with the server's message; whatever
 * depends on it waits until it is retried or discarded.
 */
export class Outbox {
  constructor(
    private readonly db: SqlDatabase,
    private readonly senders: Readonly<Partial<Record<string, OutboxSender>>>,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Adds an item inside the capture's own transaction. */
  async enqueue(
    tx: SqlExecutor,
    item: { id: string; owner: string; kind: string; payload: unknown; dependsOn?: string[] },
  ): Promise<void> {
    await tx.run(
      `INSERT INTO outbox (id, owner, kind, payload, depends_on, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.owner,
        item.kind,
        JSON.stringify(item.payload),
        JSON.stringify(item.dependsOn ?? []),
        this.clock(),
      ],
    );
  }

  /** Everything this person has waiting, oldest first, for the upload queue screen. */
  async items(owner: string): Promise<OutboxItem[]> {
    const records = await this.db.all<OutboxRecord>(
      'SELECT * FROM outbox WHERE owner = ? ORDER BY seq',
      [owner],
    );
    return records.map(toItem);
  }

  async counts(owner: string): Promise<OutboxCounts> {
    const row = await this.db.get<{ queued: number; parked: number; oldest: number | null }>(
      `SELECT coalesce(sum(state = 'queued'), 0) AS queued,
              coalesce(sum(state = 'parked'), 0) AS parked,
              min(created_at) AS oldest
         FROM outbox WHERE owner = ?`,
      [owner],
    );
    return { queued: row?.queued ?? 0, parked: row?.parked ?? 0, oldestAt: row?.oldest ?? null };
  }

  /** Uploads what it can, in order. Run one at a time: the sync runner makes sure of it. */
  async run(owner: string): Promise<RunResult> {
    for (;;) {
      const record = await this.db.get<OutboxRecord>(
        `SELECT * FROM outbox o
          WHERE o.owner = ? AND o.state = 'queued'
            AND NOT EXISTS (
              SELECT 1 FROM json_each(o.depends_on) d JOIN outbox p ON p.id = d.value)
          ORDER BY o.seq LIMIT 1`,
        [owner],
      );
      if (!record) return { status: 'done' };
      const item = toItem(record);
      const now = this.clock();
      if (item.nextAttemptAt !== null && item.nextAttemptAt > now) {
        return { status: 'waiting', until: item.nextAttemptAt };
      }
      const sender = this.senders[item.kind];
      if (!sender) {
        await this.park(item, OUTBOX_CODES.unknownKind, `Nothing uploads ${item.kind} items.`);
        continue;
      }
      try {
        await sender.send(item.payload, item);
      } catch (error) {
        const failure = classify(error);
        if (failure === 'stop') return { status: 'stopped', error };
        const { code, message } = describe(error);
        if (failure === 'permanent') {
          await this.park(item, code, message);
          continue;
        }
        const retryAfter =
          error instanceof ApiError && error.retryAfterSeconds
            ? error.retryAfterSeconds * 1_000
            : 0;
        const until = now + Math.max(backoff(item.attempts), retryAfter);
        await this.update(item.seq, {
          attempts: item.attempts + 1,
          next_attempt_at: until,
          last_error: message,
          last_error_code: code,
        });
        return { status: 'waiting', until, error };
      }
      await this.db.run('DELETE FROM outbox WHERE seq = ?', [item.seq]);
    }
  }

  /** Puts a parked item back in the queue, to go at the next run. */
  async retry(id: string): Promise<void> {
    await this.db.run(
      `UPDATE outbox SET state = 'queued', attempts = 0, next_attempt_at = NULL,
                         last_error = NULL, last_error_code = NULL
        WHERE id = ?`,
      [id],
    );
  }

  /**
   * Drops an item for good; the screen asks first. Items waiting on it park, since they can't
   * upload as they are, and its sender cleans up after it.
   */
  async discard(id: string): Promise<void> {
    const record = await this.db.get<OutboxRecord>('SELECT * FROM outbox WHERE id = ?', [id]);
    if (!record) return;
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM outbox WHERE id = ?', [id]);
      await tx.run(
        `UPDATE outbox SET state = 'parked', last_error = NULL, last_error_code = ?
          WHERE EXISTS (SELECT 1 FROM json_each(outbox.depends_on) d WHERE d.value = ?)`,
        [OUTBOX_CODES.dependencyDiscarded, id],
      );
    });
    const item = toItem(record);
    await this.senders[item.kind]?.discard?.(item.payload);
  }

  private async park(item: OutboxItem, code: string, message: string): Promise<void> {
    await this.update(item.seq, {
      state: 'parked',
      attempts: item.attempts + 1,
      next_attempt_at: null,
      last_error: message,
      last_error_code: code,
    });
  }

  private async update(seq: number, set: Record<string, SqlValue>): Promise<void> {
    const columns = Object.keys(set);
    await this.db.run(
      `UPDATE outbox SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE seq = ?`,
      [...Object.values(set), seq],
    );
  }
}

function describe(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  if (error instanceof NetworkError) return { code: 'NETWORK', message: error.message };
  return { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) };
}
