import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { cell, isolation } from './common';
import { users } from './iam';
import { media } from './media';

/**
 * Tenant data exports (module M21, decision D95), owned by the governance module: one row per
 * archive asked for, from the queue to the signed ZIP, a `media` row kept for seven days.
 */
export const dataExports = cell
  .table(
    'data_exports',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').notNull(),
      status: text('status').notNull().default('queued'),
      /** The person who asked; null for vendor staff, named in `requester_name` either way. */
      requestedBy: uuid('requested_by'),
      requesterName: text('requester_name').notNull(),
      fileMediaId: uuid('file_media_id'),
      fileName: text('file_name'),
      size: bigint('size', { mode: 'number' }),
      sha256: text('sha256'),
      tableCount: integer('table_count'),
      rowCount: bigint('row_count', { mode: 'number' }),
      fileCount: integer('file_count'),
      keyId: text('key_id'),
      error: text('error'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      finishedAt: timestamp('finished_at', { withTimezone: true }),
      expiresAt: timestamp('expires_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('data_exports_tenant_created').on(table.tenantId, table.createdAt),
      foreignKey({
        name: 'data_exports_file_fk',
        columns: [table.tenantId, table.fileMediaId],
        foreignColumns: [media.tenantId, media.id],
      }),
      foreignKey({
        name: 'data_exports_user_fk',
        columns: [table.tenantId, table.requestedBy],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Requests from people about their personal data (module M21, decision D95): access, correction
 * or erasure, raised by the person on their phone or logged for them by an admin, due 30 days on.
 * An access request carries the archive of the person's own data, a `media` row kept for 7 days.
 */
export const dataRequests = cell
  .table(
    'data_requests',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').notNull(),
      userId: uuid('user_id').notNull(),
      kind: text('kind').notNull(),
      status: text('status').notNull().default('received'),
      details: text('details').notNull().default(''),
      response: text('response'),
      /** Raised by the person themselves, or by the admin named here. */
      self: boolean('self').notNull(),
      raisedByName: text('raised_by_name').notNull(),
      dueOn: date('due_on').notNull(),
      archiveStatus: text('archive_status'),
      archiveMediaId: uuid('archive_media_id'),
      archiveSize: bigint('archive_size', { mode: 'number' }),
      archiveSha256: text('archive_sha256'),
      archiveExpiresAt: timestamp('archive_expires_at', { withTimezone: true }),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      closedAt: timestamp('closed_at', { withTimezone: true }),
      closedByName: text('closed_by_name'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('data_requests_tenant_status_due').on(table.tenantId, table.status, table.dueOn),
      index('data_requests_tenant_user').on(table.tenantId, table.userId),
      foreignKey({
        name: 'data_requests_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'data_requests_archive_fk',
        columns: [table.tenantId, table.archiveMediaId],
        foreignColumns: [media.tenantId, media.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
