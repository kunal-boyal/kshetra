// The `migrate` entrypoint (spec 9.4): applies pending migrations as the migrator role.
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { runMigrations } from './db/migrations';

const env = z.object({ DATABASE_MIGRATOR_URL: z.url() }).parse(process.env);
// Bundled into dist/, so the migrations folder sits one level up.
await runMigrations(
  env.DATABASE_MIGRATOR_URL,
  fileURLToPath(new URL('../drizzle', import.meta.url)),
);
console.log('Migrations applied.');
