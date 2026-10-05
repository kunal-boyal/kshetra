// `pnpm db:bootstrap`: creates the database roles on a local database (see db/bootstrap.ts).
import { z } from 'zod';
import { bootstrapDatabase } from './db/bootstrap';

const env = z
  .object({
    DATABASE_BOOTSTRAP_URL: z.url(),
    DATABASE_MIGRATOR_URL: z.url(),
    DATABASE_URL: z.url(),
    DIRECTORY_DATABASE_URL: z.url(),
  })
  .parse(process.env);

await bootstrapDatabase({
  admin: env.DATABASE_BOOTSTRAP_URL,
  migrator: env.DATABASE_MIGRATOR_URL,
  cellApp: env.DATABASE_URL,
  directoryApp: env.DIRECTORY_DATABASE_URL,
});
console.log('Database roles are ready: migrator, cell_app, directory_app.');
