import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** Applies every pending migration in `folder`, connected as the `migrator` role. */
export async function runMigrations(migratorUrl: string, folder: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: migratorUrl, max: 1, application_name: 'migrate' });
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}
