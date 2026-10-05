import { sql } from 'drizzle-orm';
import {
  jsonb,
  pgPolicy,
  pgRole,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Database roles (spec 9.5). They are created outside migrations: by `pnpm db:bootstrap` on local and
 * CI databases, by infrastructure in AWS.
 * - `migrator` owns the schemas and runs migrations and cross-tenant maintenance.
 * - `cell_app` is what the API connects as. It has no BYPASSRLS, so policies filter every query.
 * - `directory_app` is the directory module's role, the only one allowed into the `directory` schema.
 */
export const cellApp = pgRole('cell_app').existing();

/** Tenant business data. Every table here has `tenant_id` and the tenant-isolation policy. */
export const cell = pgSchema('cell');

/** Identities, the tenant registry and cells (spec 10.3). Tables arrive with the directory module. */
export const directory = pgSchema('directory');

/**
 * The tenant-isolation policy for every `cell` table (spec 9.5, layer 1). The API sets
 * `app.tenant_id` per transaction; without it the setting is missing or empty, and the uuid cast
 * fails, so a query that forgot its tenant errors instead of leaking rows.
 */
export const tenantIsolation = sql`tenant_id = current_setting('app.tenant_id')::uuid`;

/** What an idempotent request stored, replayed as is when the same key comes back (BR-46). */
export interface StoredResponse {
  status: number;
  body: unknown;
}

export const idempotencyKeys = cell
  .table(
    'idempotency_keys',
    {
      tenantId: uuid('tenant_id').notNull(),
      key: text('key').notNull(),
      requestHash: text('request_hash').notNull(),
      response: jsonb('response').$type<StoredResponse>(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.key] }),
      pgPolicy('tenant_isolation', {
        as: 'permissive',
        for: 'all',
        to: cellApp,
        using: tenantIsolation,
        withCheck: tenantIsolation,
      }),
    ],
  )
  .enableRLS();
