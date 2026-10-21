import { EXPORT_STATUSES, type ReportFilters } from '@kshetra/shared';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { cell, isolation } from './common';
import { users } from './iam';
import { media } from './media';

export const exportStatus = cell.enum('export_status', EXPORT_STATUSES);

/**
 * Exports (module M18, decision D62), owned by the reports module: one row per file asked for,
 * from the queue to the file, which is a `media` row kept for seven days.
 */
export const exportJobs = cell
  .table(
    'export_jobs',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      report: text('report').notNull(),
      filters: jsonb('filters').$type<ReportFilters>().notNull(),
      format: text('format').notNull(),
      locale: text('locale').notNull(),
      status: exportStatus('status').notNull().default('queued'),
      rowCount: integer('row_count'),
      fileMediaId: uuid('file_media_id'),
      fileName: text('file_name'),
      error: text('error'),
      createdBy: uuid('created_by').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      finishedAt: timestamp('finished_at', { withTimezone: true }),
      expiresAt: timestamp('expires_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('export_jobs_tenant_user_created').on(table.tenantId, table.createdBy, table.createdAt),
      index('export_jobs_tenant_expires').on(table.tenantId, table.expiresAt),
      foreignKey({
        name: 'export_jobs_file_fk',
        columns: [table.tenantId, table.fileMediaId],
        foreignColumns: [media.tenantId, media.id],
      }),
      foreignKey({
        name: 'export_jobs_user_fk',
        columns: [table.tenantId, table.createdBy],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
