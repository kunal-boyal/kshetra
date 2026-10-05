import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Config } from '../config';
import * as schema from '../db/schema';
import { CONFIG } from './tokens';

export type Db = NodePgDatabase<typeof schema>;
/** A transaction with the tenant already set; everything tenant-owned goes through one. */
export type TenantTx = Parameters<Parameters<Db['transaction']>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class Database implements OnModuleDestroy {
  private readonly logger = new Logger(Database.name);
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
  async forTenant<T>(tenantId: string, work: (tx: TenantTx) => Promise<T>): Promise<T> {
    if (!UUID.test(tenantId)) {
      throw new Error('A tenant ID must be a UUID.');
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return work(tx);
    });
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
