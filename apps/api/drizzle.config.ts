import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` writes a migration for every schema change; review it before committing.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  schemaFilter: ['cell', 'directory'],
});
