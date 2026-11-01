import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cell, isolation, rowVersionColumn } from './common';

/**
 * Schemes and promotions on orders (BR-55, decision D127): what each gives (`kind` and `rule`),
 * whom it reaches (items or categories, account types, territories) and when. A scheme's key never
 * changes; each change raises its version. Orders keep the scheme as it was on their lines.
 */
export const schemes = cell
  .table(
    'schemes',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      key: text('key').notNull(),
      /** `{ en, hi }`. */
      name: jsonb('name').notNull(),
      kind: text('kind').notNull(),
      rule: jsonb('rule').notNull(),
      itemIds: uuid('item_ids').array().notNull().default([]),
      categoryIds: uuid('category_ids').array().notNull().default([]),
      accountTypeKeys: text('account_type_keys').array().notNull().default([]),
      territoryIds: uuid('territory_ids').array().notNull().default([]),
      validFrom: date('valid_from').notNull(),
      validTo: date('valid_to'),
      active: boolean('active').notNull().default(true),
      version: integer('version').notNull().default(1),
      createdBy: uuid('created_by'),
      updatedBy: uuid('updated_by'),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      rowVersion: rowVersionColumn(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('schemes_tenant_key').on(table.tenantId, table.key),
      index('schemes_tenant_row_version').on(table.tenantId, table.rowVersion),
      isolation(),
    ],
  )
  .enableRLS();
