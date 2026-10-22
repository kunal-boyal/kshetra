// `pnpm db:bootstrap`: creates the database roles on a local database, or on a cell's database in
// AWS when BOOTSTRAP_CONFIRM_HOST names its host (see db/bootstrap.ts and docs/runbooks/).
import { z } from 'zod';
import { bootstrapDatabase } from './db/bootstrap';

const env = z
  .object({
    DATABASE_BOOTSTRAP_URL: z.url(),
    DATABASE_MIGRATOR_URL: z.url(),
    DATABASE_URL: z.url(),
    DIRECTORY_DATABASE_URL: z.url(),
    BOOTSTRAP_CONFIRM_HOST: z.string().min(1).optional(),
  })
  .parse(process.env);

await bootstrapDatabase(
  {
    admin: env.DATABASE_BOOTSTRAP_URL,
    migrator: env.DATABASE_MIGRATOR_URL,
    cellApp: env.DATABASE_URL,
    directoryApp: env.DIRECTORY_DATABASE_URL,
  },
  env.BOOTSTRAP_CONFIRM_HOST,
);
console.log('Database roles are ready: migrator, cell_app, directory_app.');
