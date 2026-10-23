import { newId } from '@thelamp/shared';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { idempotencyKeys } from '../src/db/schema';
import { Database } from '../src/platform/database';
import { testConfig } from './support';

const urls = inject('databaseUrls');

/** The PostgreSQL error code under the query-builder's wrapper, for example 42501 for a policy violation. */
function pgCode(error: unknown): string | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ('code' in current && typeof current.code === 'string') return current.code;
  }
  return undefined;
}

async function asAdmin<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: urls.admin });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

describe('row-level security (spec 9.5)', () => {
  const tenantA = newId();
  const tenantB = newId();
  let database: Database;

  beforeAll(async () => {
    database = new Database(testConfig({ DATABASE_URL: urls.cellApp, DB_POOL_MAX: '1' }));
    await database.forTenant(tenantA, (tx) =>
      tx.insert(idempotencyKeys).values({ tenantId: tenantA, key: 'same-key', requestHash: 'a' }),
    );
    await database.forTenant(tenantB, (tx) =>
      tx.insert(idempotencyKeys).values({ tenantId: tenantB, key: 'same-key', requestHash: 'b' }),
    );
  });

  afterAll(() => database.onModuleDestroy());

  it('shows a tenant only its own rows, even when the query has no tenant filter', async () => {
    const rows = await database.forTenant(tenantA, (tx) => tx.select().from(idempotencyKeys));
    expect(rows.map((row) => row.tenantId)).toEqual([tenantA]);
  });

  it("refuses to write a row into another tenant's data", async () => {
    const error = await database
      .forTenant(tenantA, (tx) =>
        tx.insert(idempotencyKeys).values({ tenantId: tenantB, key: 'planted', requestHash: 'x' }),
      )
      .catch((caught: unknown) => caught);
    // 42501: the row violates the row-level security policy.
    expect(pgCode(error)).toBe('42501');
    const rows = await database.forTenant(tenantB, (tx) => tx.select().from(idempotencyKeys));
    expect(rows.map((row) => row.key)).toEqual(['same-key']);
  });

  it("cannot change another tenant's rows", async () => {
    const changed = await database.forTenant(tenantA, (tx) =>
      tx
        .update(idempotencyKeys)
        .set({ requestHash: 'tampered' })
        .where(eq(idempotencyKeys.tenantId, tenantB))
        .returning(),
    );
    expect(changed).toHaveLength(0);
    const [row] = await database.forTenant(tenantB, (tx) => tx.select().from(idempotencyKeys));
    expect(row?.requestHash).toBe('b');
  });

  it('fails closed when a query forgets to set the tenant', async () => {
    const client = new pg.Client({ connectionString: urls.cellApp });
    await client.connect();
    try {
      // A fresh connection has no app.tenant_id at all.
      await expect(client.query('select * from cell.idempotency_keys')).rejects.toThrow(
        /app\.tenant_id/,
      );
      // A pooled connection that just served a tenant has it reset to empty, which also fails.
      await client.query('begin');
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantA]);
      await client.query('commit');
      await expect(client.query('select * from cell.idempotency_keys')).rejects.toThrow(/uuid/);
    } finally {
      await client.end();
    }
  });

  it('rejects a tenant ID that is not a UUID before touching the database', async () => {
    await expect(database.forTenant("x' or '1'='1", async () => 1)).rejects.toThrow(/UUID/);
  });
});

describe('database roles', () => {
  it('give the application roles no way around row-level security', async () => {
    const rows = await asAdmin<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }>(
      "select rolname, rolbypassrls, rolsuper from pg_roles where rolname in ('cell_app', 'directory_app') order by rolname",
    );
    expect(rows).toEqual([
      { rolname: 'cell_app', rolbypassrls: false, rolsuper: false },
      { rolname: 'directory_app', rolbypassrls: false, rolsuper: false },
    ]);
  });

  it('keep cell_app out of the directory schema and directory_app out of tenant data', async () => {
    const [row] = await asAdmin<Record<string, boolean>>(
      `select has_schema_privilege('cell_app', 'directory', 'USAGE') as cell_in_directory,
              has_schema_privilege('directory_app', 'directory', 'USAGE') as directory_in_directory,
              has_schema_privilege('directory_app', 'cell', 'USAGE') as directory_in_cell`,
    );
    expect(row).toEqual({
      cell_in_directory: false,
      directory_in_directory: true,
      directory_in_cell: false,
    });
  });

  it('let only the migrator change the structure', async () => {
    const client = new pg.Client({ connectionString: urls.cellApp });
    await client.connect();
    try {
      await expect(client.query('create table cell.planted (id int)')).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await client.end();
    }
  });
});

describe('every table in the cell schema', () => {
  it('has tenant_id, row-level security and a policy on app.tenant_id', async () => {
    const tables = await asAdmin<{
      table: string;
      rls: boolean;
      has_tenant: boolean;
      policies: number;
    }>(
      `select c.relname as table,
              c.relrowsecurity as rls,
              exists (select 1 from information_schema.columns col
                      where col.table_schema = 'cell' and col.table_name = c.relname
                        and col.column_name = 'tenant_id') as has_tenant,
              (select count(*)::int from pg_policies p
                where p.schemaname = 'cell' and p.tablename = c.relname
                  and p.qual like '%app.tenant_id%' and p.with_check like '%app.tenant_id%') as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'cell' and c.relkind in ('r', 'p')
        order by c.relname`,
    );
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table, table.table).toMatchObject({ rls: true, has_tenant: true });
      expect(table.policies, table.table).toBeGreaterThanOrEqual(1);
    }
  });
});
