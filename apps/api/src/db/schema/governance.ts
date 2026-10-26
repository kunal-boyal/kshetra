import {
  bigint,
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
