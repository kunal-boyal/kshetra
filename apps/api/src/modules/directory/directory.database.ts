import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Config } from '../../config';
import * as schema from '../../db/schema/directory';
import { CONFIG } from '../../platform/tokens';

export type DirectoryDb = NodePgDatabase<typeof schema>;
export type DirectoryTx = Parameters<Parameters<DirectoryDb['transaction']>[0]>[0];

/**
 * The directory module's own connection, as `directory_app` (decision D23). No other module
 * reaches the directory schema; they call this module's services instead.
 */
@Injectable()
export class DirectoryDatabase implements OnModuleDestroy {
  private readonly logger = new Logger(DirectoryDatabase.name);
  readonly pool: pg.Pool;
  readonly db: DirectoryDb;
  private readonly committed = new WeakMap<DirectoryTx, (() => void)[]>();

  constructor(@Inject(CONFIG) config: Config) {
    this.pool = new pg.Pool({
      connectionString: config.DIRECTORY_DATABASE_URL,
      max: config.DB_POOL_MAX,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 30_000,
      application_name: `directory:${config.CELL_ID}`,
    });
    this.pool.on('error', (error) =>
      this.logger.warn(`Idle directory connection failed: ${error.message}`),
    );
    this.db = drizzle(this.pool, { schema });
    // Every transaction keeps the tasks to run once it commits (`whenCommitted()`).
    const transaction = this.db.transaction.bind(this.db);
    this.db.transaction = (async (work, config) => {
      const tasks: (() => void)[] = [];
      const result = await transaction(async (tx) => {
        this.committed.set(tx, tasks);
        return work(tx);
      }, config);
      for (const task of tasks) task();
      return result;
    }) as DirectoryDb['transaction'];
  }

  /**
   * Runs `task` once `tx` commits; at once for a savepoint inside one, or outside any. For what
   * must never be done for a change that rolled back, such as mirroring an audit entry to the
   * logs (decision D101).
   */
  whenCommitted(tx: DirectoryTx, task: () => void): void {
    const tasks = this.committed.get(tx);
    if (tasks) tasks.push(task);
    else task();
  }

  /** For readiness: can the directory reach its database? */
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
