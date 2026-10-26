// `node dist/restore-check.mjs`: the restore drill's look at a database restored beside the cell's
// (infra/scripts/restore-drill.sh, decision D98). It reads the copy at RESTORE_CHECK_HOST as the
// migrator, which owns the schemas, and prints one JSON line: the migrations it has, how many
// tenants and people, and its newest write, whose age is how much a real restore would lose.
import pg from 'pg';
import { z } from 'zod';
import { restoredUrl } from './restore-url';

const env = z
  .object({ DATABASE_MIGRATOR_URL: z.url(), RESTORE_CHECK_HOST: z.string().min(1) })
  .parse(process.env);
const client = new pg.Client({
  connectionString: restoredUrl(env.DATABASE_MIGRATOR_URL, env.RESTORE_CHECK_HOST),
  application_name: 'restore-check',
});
await client.connect();
try {
  const { rows } = await client.query<{
    migrations: number;
    tenants: number;
    people: number;
    newest: Date | null;
  }>(
    `select (select count(*)::int from drizzle.__drizzle_migrations) as migrations,
            (select count(*)::int from directory.tenants) as tenants,
            (select count(*)::int from cell.users) as people,
            greatest((select max(created_at) from cell.audit_log),
                     (select max(created_at) from cell.outbox_events)) as newest`,
  );
  const found = rows[0]!;
  console.log(
    JSON.stringify({
      ...found,
      newest: found.newest?.toISOString() ?? null,
      newestAgeSeconds: found.newest
        ? Math.round((Date.now() - found.newest.getTime()) / 1000)
        : null,
    }),
  );
  if (found.migrations === 0) process.exitCode = 1;
} finally {
  await client.end();
}
