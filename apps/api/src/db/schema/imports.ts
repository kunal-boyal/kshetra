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
import { cell, isolation } from './common';
import { users } from './iam';
import { media } from './media';

export const importStatus = cell.enum('import_status', [
  'reading',
  'mapping',
  'validating',
  'ready',
  'invalid',
  'committing',
  'committed',
  'failed',
]);

/** One problem with one row, or with the file as a whole when `row` is null. */
export interface ImportProblem {
  row: number | null;
  field: string | null;
  issue: string;
}

/** A row of the preview: its number in the file, its values by field, and its problems. */
export interface PreviewRow {
  row: number;
  values: Record<string, string>;
  problems: string[];
}

/**
 * Imports (module M19), owned by the imports module: one row per uploaded file, through reading,
 * mapping, checking and the all-or-nothing commit. The file itself is a `media` row.
 */
export const importJobs = cell
  .table(
    'import_jobs',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      target: text('target').notNull(),
      fileMediaId: uuid('file_media_id').notNull(),
      fileName: text('file_name').notNull(),
      sheets: jsonb('sheets').$type<string[]>().notNull().default([]),
      sheet: text('sheet'),
      headerRow: integer('header_row'),
      headers: jsonb('headers').$type<string[]>().notNull().default([]),
      mapping: jsonb('mapping').$type<Record<string, string | null>>().notNull().default({}),
      status: importStatus('status').notNull().default('reading'),
      totalRows: integer('total_rows'),
      /** Empty rows between the header and the last row with anything in it. */
      skippedRows: integer('skipped_rows'),
      errorRows: integer('error_rows'),
      errors: jsonb('errors').$type<ImportProblem[]>().notNull().default([]),
      preview: jsonb('preview').$type<PreviewRow[]>().notNull().default([]),
      /** What a clean check found the rows would add and change, for targets that can tell. */
      plannedCreate: integer('planned_create'),
      plannedUpdate: integer('planned_update'),
      created: integer('created'),
      updated: integer('updated'),
      createdBy: uuid('created_by').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      finishedAt: timestamp('finished_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('import_jobs_tenant_created').on(table.tenantId, table.createdAt),
      foreignKey({
        name: 'import_jobs_file_fk',
        columns: [table.tenantId, table.fileMediaId],
        foreignColumns: [media.tenantId, media.id],
      }),
      foreignKey({
        name: 'import_jobs_user_fk',
        columns: [table.tenantId, table.createdBy],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Saved mappings (M19): which header in a customer's files means which field, by target. A
 * template's aliases arrive as the mapping named `template`.
 */
export const importMappings = cell
  .table(
    'import_mappings',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      target: text('target').notNull(),
      name: text('name').notNull(),
      // Headers as the importer compares them (lowercase letters and digits) to field keys.
      mapping: jsonb('mapping').$type<Record<string, string>>().notNull(),
      emptyValues: jsonb('empty_values').$type<string[]>().notNull().default([]),
      /** Percentage columns where a value of 1 or less is a fraction (BR-17). */
      fractions: jsonb('fractions').$type<string[]>().notNull().default([]),
      createdBy: uuid('created_by'),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('import_mappings_tenant_target_name').on(
        table.tenantId,
        table.target,
        table.name,
      ),
      isolation(),
    ],
  )
  .enableRLS();
