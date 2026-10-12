import { bigint, foreignKey, index, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cell, isolation } from './common';
import { users } from './iam';

/** What a stored file is for (spec 10.3). Photos and the rest arrive with the media pipeline. */
export const mediaKind = cell.enum('media_kind', [
  'evidence',
  'field_photo',
  'selfie',
  'attachment',
  'receipt',
  'odometer',
  'signature',
  'import_file',
  'export_file',
]);

export const mediaStatus = cell.enum('media_status', [
  'pending',
  'uploaded',
  'processed',
  'rejected',
  'deleted',
]);

/**
 * Files in the object store (spec 10.3, 12.2), owned by the media module. The row says what the
 * file is and whose; the bytes live under `object_key`. Columns for photos (where and when they
 * were taken, duplicate checks, derivatives) join with the media pipeline.
 */
export const media = cell
  .table(
    'media',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id'),
      kind: mediaKind('kind').notNull(),
      objectKey: text('object_key').notNull(),
      fileName: text('file_name'),
      contentType: text('content_type').notNull(),
      size: bigint('size', { mode: 'number' }).notNull(),
      sha256: text('sha256').notNull(),
      status: mediaStatus('status').notNull().default('pending'),
      ownerType: text('owner_type'),
      ownerId: uuid('owner_id'),
      retentionClass: text('retention_class').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('media_tenant_sha256').on(table.tenantId, table.sha256),
      index('media_tenant_owner').on(table.tenantId, table.ownerType, table.ownerId),
      foreignKey({
        name: 'media_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
