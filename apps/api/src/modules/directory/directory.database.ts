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
