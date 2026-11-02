import type { ErpProblem, ErpRunResult, ErpSettings } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cell, changeColumns, isolation } from './common';

/**
 * A tenant's connection to its ERP (module M20, BR-59 to BR-61, decision D129): Zoho's
 * organisation and region with its refresh token, SAP Business One's Service Layer, company and
 * user with its password, each secret sealed under `COLUMN_KEY` naming its column and row, or
 * Tally's company and the groups and voucher types its files have shown; and the mappings. One a
 * tenant and provider; disconnecting forgets the token and keeps the row, so its links carry on
 * when it connects again.
 */
export const erpConnections = cell
  .table(
    'erp_connections',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').notNull(),
      provider: text('provider').notNull(),
      status: text('status').notNull(),
      accountsServer: text('accounts_server'),
      apiDomain: text('api_domain'),
      organizationId: text('organization_id'),
      organizationName: text('organization_name'),
      /** The organisations to choose from while the status is `choosing`. */
      organizations: jsonb('organizations')
        .$type<{ id: string; name: string }[]>()
        .notNull()
        .default([]),
      refreshTokenSealed: text('refresh_token_sealed'),
      /** SAP: the Service Layer's root, the company database and the connection's user. */
      endpoint: text('endpoint'),
      companyDb: text('company_db'),
      username: text('username'),
      /** SAP: the user's password, sealed as the refresh token is; never shown again. */
      credentialsSealed: text('credentials_sealed'),
      /** SAP: the day each kind of record was last read through, for reading only what changed. */
      cursors: jsonb('cursors').$type<Partial<Record<string, string>>>().notNull().default({}),
      /**
       * Tally: each group's and voucher type's parent, from every file uploaded, so a Day Book
       * uploaded alone still knows which ledgers are customers and which vouchers are sales.
       */
      structure: jsonb('structure')
        .$type<{ groups?: Record<string, string>; voucherTypes?: Record<string, string> }>()
        .notNull()
        .default({}),
      settings: jsonb('settings').$type<ErpSettings>().notNull(),
      connectedBy: uuid('connected_by'),
      connectedAt: timestamp('connected_at', { withTimezone: true }),
      lastRunAt: timestamp('last_run_at', { withTimezone: true }),
      /** The calls made on `calls_day` (the provider's day, UTC), against its daily limit. */
      callsDay: text('calls_day'),
      callsUsed: integer('calls_used').notNull().default(0),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('erp_connections_tenant_provider').on(table.tenantId, table.provider),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * What a record in the books is here (decision D129): the account, item, invoice, receipt or order
 * it became, by its code or number, with the fingerprint of the row last written and the time the
 * books last changed it, so an unchanged record costs nothing. A record seen but not taken (no
 * customer number, say) has no local key, and is looked at again only once the books change it.
 */
export const erpLinks = cell
  .table(
    'erp_links',
    {
      tenantId: uuid('tenant_id').notNull(),
      connectionId: uuid('connection_id').notNull(),
      entity: text('entity').notNull(),
      externalId: text('external_id').notNull(),
      localKey: text('local_key'),
      /** Tally: the record's name there, by which its vouchers refer to it (BR-61). */
      externalName: text('external_name'),
      fingerprint: text('fingerprint'),
      externalModified: text('external_modified'),
      linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({
        columns: [table.tenantId, table.connectionId, table.entity, table.externalId],
      }),
      uniqueIndex('erp_links_local_key')
        .on(table.tenantId, table.connectionId, table.entity, table.localKey)
        .where(sql`${table.localKey} is not null`),
      foreignKey({
        name: 'erp_links_connection_fk',
        columns: [table.tenantId, table.connectionId],
        foreignColumns: [erpConnections.tenantId, erpConnections.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * One run of a connection (decision D129): what it read and wrote by entity, the problems it met
 * (at most 200, never a value), the calls it made, the file it read (Tally), and why it stopped
 * short. Kept 90 days.
 */
export const erpRuns = cell
  .table(
    'erp_runs',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').notNull(),
      connectionId: uuid('connection_id').notNull(),
      kind: text('kind').notNull(),
      status: text('status').notNull(),
      stoppedBy: text('stopped_by'),
      counts: jsonb('counts').$type<ErpRunResult['counts']>().notNull().default({}),
      problems: jsonb('problems').$type<ErpProblem[]>().notNull().default([]),
      calls: integer('calls').notNull().default(0),
      /** Tally: the file uploaded (media of kind `import_file`) and its name (BR-61). */
      fileMediaId: uuid('file_media_id'),
      fileName: text('file_name'),
      startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
      finishedAt: timestamp('finished_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('erp_runs_connection_started').on(table.tenantId, table.connectionId, table.startedAt),
      foreignKey({
        name: 'erp_runs_connection_fk',
        columns: [table.tenantId, table.connectionId],
        foreignColumns: [erpConnections.tenantId, erpConnections.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
