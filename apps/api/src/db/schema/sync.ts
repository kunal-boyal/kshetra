import { index, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cell, isolation, rowVersionColumn } from './common';

/**
 * Rows the phones must drop (spec 10.3, 11.3), owned by the sync module. A pull that sends
 * changes sends the tombstones written since its cursor, so a row removed from the server, or
 * from what phones should hold, leaves them too. Tombstones are purged after 35 days, and a
 * cursor older than 28 days takes a full copy instead (decision D40).
 */
export const syncTombstones = cell
  .table(
    'sync_tombstones',
    {
      tenantId: uuid('tenant_id').notNull(),
      entity: text('entity').notNull(),
      entityId: uuid('entity_id').notNull(),
      rowVersion: rowVersionColumn(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.entity, table.entityId] }),
      index('sync_tombstones_tenant_entity_row_version').on(
        table.tenantId,
        table.entity,
        table.rowVersion,
      ),
      // The purge looks across tenants for what is old, so this one index is not led by tenant.
      index('sync_tombstones_created_at').on(table.createdAt),
      isolation(),
    ],
  )
  .enableRLS();
