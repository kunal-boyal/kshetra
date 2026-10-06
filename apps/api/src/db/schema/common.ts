import { sql } from 'drizzle-orm';
import { bigint, pgPolicy, pgRole, pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';

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

/** Identities, the tenant registry and cells (spec 10.3), reached only by `directory_app`. */
export const directory = pgSchema('directory');

/**
 * The tenant-isolation policy for every `cell` table (spec 9.5, layer 1). The API sets
 * `app.tenant_id` per transaction; without it the setting is missing or empty, and the uuid cast
 * fails, so a query that forgot its tenant errors instead of leaking rows.
 */
export const tenantIsolation = sql`tenant_id = current_setting('app.tenant_id')::uuid`;

/** The tenant-isolation policy itself; every `cell` table declares it and enables RLS. */
export const isolation = () =>
  pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: cellApp,
    using: tenantIsolation,
    withCheck: tenantIsolation,
  });

/** `created_at`, `created_by`, `updated_at` and `updated_by`, which mutable tables carry (spec 10.1). */
export const changeColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Null when the system made the change, for example while provisioning a tenant.
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

/**
 * Syncable rows take a new value from this sequence on every insert and update (a trigger covers
 * updates), so the mobile sync can ask for everything changed since a cursor (spec 10.1, 11.3).
 */
export const rowVersion = cell.sequence('row_version');

export const rowVersionColumn = () =>
  bigint('row_version', { mode: 'number' })
    .notNull()
    .default(sql`nextval('cell.row_version')`);
