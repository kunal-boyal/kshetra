import type { SyncEntity } from '@kshetra/shared';
import { ApiError, NetworkError } from '../client';
import type { Outbox, OutboxCounts } from './outbox';
import { lastPulledAt, pull, type PullClient } from './pull';
import type { SqlDatabase } from './sql';

/** What the sync banner and the upload queue show. */
export interface SyncStatus {
  running: boolean;
  /** The last run could not reach the server. */
  offline: boolean;
  /** The error code that stopped the last run, other than having no network. */
  error: string | null;
  /** When the last pull finished, in milliseconds since the epoch. */
  lastPulledAt: number | null;
  counts: OutboxCounts;
}

export interface SyncRunnerOptions {
  db: SqlDatabase;
  client: PullClient;
  outbox: Outbox;
  entities: readonly SyncEntity[];
  /** `tenant:user` of whoever is signed in, or null when nobody is. */
  owner: () => string | null;
  /**
   * Uploads that follow the outbox once it has nothing more to send, such as location points,
   * whose shifts must reach the server first.
   */
  afterPush?: (owner: string) => Promise<void>;
  clock?: () => number;
}

/** A transient failure waits at most this long before the runner tries by itself. */
const MAX_WAKE_MS = 15 * 60_000;

/**
 * One sync at a time (spec 11.3): first the outbox uploads what it can, then the pull brings the
 * reference data up to date. Asked again while it runs, it runs once more when it finishes, so a
 * capture saved mid-run is never left waiting. After a transient failure it wakes itself when the
 * oldest item may go again.
 */
export class SyncRunner {
  private current: Promise<void> | null = null;
  private again = false;
  private wake: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private state: SyncStatus = {
    running: false,
    offline: false,
    error: null,
    lastPulledAt: null,
    counts: { queued: 0, parked: 0, oldestAt: null },
  };

  constructor(private readonly options: SyncRunnerOptions) {}

  get status(): SyncStatus {
    return this.state;
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Syncs now, or once more after the run under way. */
  sync(): Promise<void> {
    if (this.current) {
      this.again = true;
      return this.current;
    }
    clearTimeout(this.wake);
    this.current = (async () => {
      try {
        do {
          this.again = false;
          await this.round();
        } while (this.again);
      } finally {
        this.current = null;
      }
    })();
    return this.current;
  }

  /** Reads the counts and the last pull again, after the outbox changed outside a run. */
  async refresh(): Promise<void> {
    const owner = this.options.owner();
    this.set({
      counts: owner
        ? await this.options.outbox.counts(owner)
        : { queued: 0, parked: 0, oldestAt: null },
      lastPulledAt: await lastPulledAt(this.options.db),
    });
  }

  /** Stops the self-wake, when the app closes or signs out. */
  stop(): void {
    clearTimeout(this.wake);
  }

  private async round(): Promise<void> {
    const owner = this.options.owner();
    if (!owner) return;
    const clock = this.options.clock ?? Date.now;
    this.set({ running: true });
    let offline = false;
    let error: string | null = null;
    try {
      const pushed = await this.options.outbox.run(owner);
      if (pushed.status === 'stopped') {
        error = codeOf(pushed.error);
        return;
      }
      if (pushed.status === 'waiting') {
        this.wakeAt(pushed.until, clock());
        if (pushed.error instanceof NetworkError) {
          offline = true;
          return;
        }
      }
      if (pushed.status === 'done') await this.options.afterPush?.(owner);
      await pull(this.options.db, this.options.client, this.options.entities, owner, clock);
    } catch (caught) {
      if (caught instanceof NetworkError) offline = true;
      else error = codeOf(caught);
    } finally {
      this.set({ running: false, offline, error });
      await this.refresh();
    }
  }

  private wakeAt(until: number, now: number): void {
    clearTimeout(this.wake);
    this.wake = setTimeout(() => void this.sync(), Math.min(MAX_WAKE_MS, Math.max(0, until - now)));
  }

  private set(change: Partial<SyncStatus>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener(this.state);
  }
}

function codeOf(error: unknown): string {
  return error instanceof ApiError ? error.code : 'INTERNAL';
}
