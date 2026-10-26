import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { AppError } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Config } from '../config';
import * as schema from '../db/schema/platform';
import { CONFIG } from './tokens';

export type Db = NodePgDatabase<typeof schema>;
/** A transaction with the tenant already set; everything tenant-owned goes through one. */
export type TenantTx = Parameters<Parameters<Db['transaction']>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TransactionOptions {
  /**
   * `repeatable read` gives every statement the same snapshot, for reads that must agree with each
   * other, such as a sync pull. A transaction that only reads never fails for it.
   */
  isolation?: 'read committed' | 'repeatable read';
  readOnly?: boolean;
}

/** The replica's URL: the setting itself, or DATABASE_URL with the replica's host. */
export function replicaUrl(
  config: Pick<Config, 'DATABASE_URL' | 'DATABASE_REPLICA_URL' | 'DATABASE_REPLICA_HOST'>,
): string | null {
  if (config.DATABASE_REPLICA_URL) return config.DATABASE_REPLICA_URL;
  if (!config.DATABASE_REPLICA_HOST) return null;
  const url = new URL(config.DATABASE_URL);
  url.hostname = config.DATABASE_REPLICA_HOST;
  return url.toString();
}

@Injectable()
export class Database implements OnModuleDestroy {
  private readonly logger = new Logger(Database.name);
  private readonly afterCommitTasks = new WeakMap<TenantTx, (() => Promise<void>)[]>();
  readonly pool: pg.Pool;
  readonly db: Db;
  /** The read replica's pool, when the cell has one (decision D98). */
  readonly replica: pg.Pool | null;
  private readonly replicaDb: Db;
  /** Set while a request's reads are to go to the replica (`@FromReplica()`). */
  private readonly replicaReads = new AsyncLocalStorage<number>();

  constructor(@Inject(CONFIG) private readonly config: Config) {
    const pool = (connectionString: string, role: string) => {
      const made = new pg.Pool({
        connectionString,
        max: config.DB_POOL_MAX,
        connectionTimeoutMillis: 2_000,
        idleTimeoutMillis: 30_000,
        application_name: `${role}:${config.CELL_ID}`,
      });
      // An idle connection that drops must not take the process down; the pool replaces it.
      made.on('error', (error) =>
        this.logger.warn(`Idle database connection failed: ${error.message}`),
      );
      return made;
    };
    this.pool = pool(config.DATABASE_URL, 'api');
    this.db = drizzle(this.pool, { schema });
    const replica = replicaUrl(config);
    this.replica = replica ? pool(replica, 'api-replica') : null;
    this.replicaDb = this.replica ? drizzle(this.replica, { schema }) : this.db;
  }

  /**
   * Runs `work` in one transaction with `app.tenant_id` set, so row-level security limits every
   * query to that tenant (spec 9.5, layer 2). Queries inside still filter by `tenant_id` explicitly
   * (layer 4).
   */
  async forTenant<T>(
    tenantId: string,
    work: (tx: TenantTx) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    if (!UUID.test(tenantId)) {
      throw new Error('A tenant ID must be a UUID.');
    }
    const timeoutMs = this.replicaReads.getStore();
    if (timeoutMs !== undefined) return this.read(tenantId, work, { timeoutMs });
    const committed: (() => Promise<void>)[] = [];
    const result = await this.db.transaction(
      async (tx) => {
        this.afterCommitTasks.set(tx, committed);
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        return work(tx);
      },
      {
        ...(options.isolation ? { isolationLevel: options.isolation } : {}),
        ...(options.readOnly ? { accessMode: 'read only' as const } : {}),
      },
    );
    for (const task of committed) {
      try {
        await task();
      } catch (error) {
        this.logger.error(`A task after commit failed: ${(error as Error).message}`);
      }
    }
    return result;
  }

  /**
   * Runs `work` as `forTenant` does, but only reading: on the read replica when the cell has one,
   * in one `repeatable read` snapshot, with each statement stopped after `timeoutMs` (spec 10.3,
   * decision D98). Reports, exports and API clients' list reads go this way; anything that must
   * see its own writes, or writes, uses `forTenant`. A statement stopped for time answers
   * `REPORT_TIMEOUT`.
   */
  async read<T>(
    tenantId: string,
    work: (tx: TenantTx) => Promise<T>,
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    if (!UUID.test(tenantId)) {
      throw new Error('A tenant ID must be a UUID.');
    }
    const timeout = options.timeoutMs ?? this.config.REPORT_STATEMENT_TIMEOUT_MS;
    try {
      return await this.replicaDb.transaction(
        async (tx) => {
          this.afterCommitTasks.set(tx, []);
          await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
          await tx.execute(sql`select set_config('statement_timeout', ${String(timeout)}, true)`);
          return work(tx);
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    } catch (error) {
      // Drizzle wraps the driver's error; Postgres's code for a cancelled statement is 57014.
      const failed = error as { code?: string; cause?: { code?: string } };
      if ((failed.code ?? failed.cause?.code) === '57014') {
        throw new AppError(
          'REPORT_TIMEOUT',
          'This took too long to read. Narrow it down, or export it instead.',
        );
      }
      throw error;
    }
  }

  /**
   * Runs `work` with every `forTenant` inside it reading through `read`, as a request marked
   * `@FromReplica()` does for an API client. Writing inside it fails.
   */
  onReplica<T>(work: () => T, timeoutMs = this.config.REPORT_STATEMENT_TIMEOUT_MS): T {
    return this.replicaReads.run(timeoutMs, work);
  }

  /**
   * Runs `task` once the transaction commits, and never if it rolls back. The change is committed
   * by then, so a failing task is logged rather than thrown; whatever it does must be retried by
   * something else, as the outbox relay does for events.
   */
  afterCommit(tx: TenantTx, task: () => Promise<void>): void {
    const tasks = this.afterCommitTasks.get(tx);
    if (!tasks) throw new Error('afterCommit needs the transaction Database.forTenant opened.');
    tasks.push(task);
  }

  /**
   * Runs `task` once `tx` commits, or at once when `tx` isn't one `forTenant` opened, such as a
   * test's own transaction. For what must never be done for a change that rolled back, such as
   * mirroring an audit entry to the logs (decision D101).
   */
  whenCommitted(tx: TenantTx, task: () => void): void {
    const tasks = this.afterCommitTasks.get(tx);
    if (tasks) tasks.push(async () => task());
    else task();
  }

  /**
   * Runs `work` in a savepoint of a transaction `forTenant` opened, so a failure undoes only
   * `work`. Its after-commit tasks join the transaction's once the savepoint is released.
   */
  async savepoint<T>(tx: TenantTx, work: (inner: TenantTx) => Promise<T>): Promise<T> {
    const outer = this.afterCommitTasks.get(tx);
    if (!outer) throw new Error('savepoint needs the transaction Database.forTenant opened.');
    const tasks: (() => Promise<void>)[] = [];
    const result = await tx.transaction(async (inner) => {
      this.afterCommitTasks.set(inner, tasks);
      return work(inner);
    });
    outer.push(...tasks);
    return result;
  }

  /** For readiness: can the API reach the database at all? The replica isn't needed to serve. */
  async ping(): Promise<boolean> {
    try {
      await this.pool.query('select 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
    await this.replica?.end();
  }
}
