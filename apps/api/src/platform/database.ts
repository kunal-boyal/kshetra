import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
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

@Injectable()
export class Database implements OnModuleDestroy {
  private readonly logger = new Logger(Database.name);
  private readonly afterCommitTasks = new WeakMap<TenantTx, (() => Promise<void>)[]>();
  readonly pool: pg.Pool;
  readonly db: Db;

  constructor(@Inject(CONFIG) config: Config) {
    this.pool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: config.DB_POOL_MAX,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 30_000,
      application_name: `api:${config.CELL_ID}`,
    });
    // An idle connection that drops must not take the process down; the pool replaces it.
    this.pool.on('error', (error) =>
      this.logger.warn(`Idle database connection failed: ${error.message}`),
    );
    this.db = drizzle(this.pool, { schema });
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

  /** For readiness: can the API reach the database at all? */
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
  }
}
