import { COUNT_FLAGS, STOCK_MOVEMENT_KINDS } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  numeric,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { items } from './catalogue';
import { cell, isolation, rowVersionColumn } from './common';
import { users } from './iam';

export const stockMovementKind = cell.enum('stock_movement_kind', STOCK_MOVEMENT_KINDS);
export const stockSourceType = cell.enum('stock_source_type', [
  'order',
  'count',
  'entry',
  'import',
]);
export const stockCountFlag = cell.enum('stock_count_flag', COUNT_FLAGS);

/**
 * Distributors' stock, as the app keeps it (module M24, BR-62, decision D130): every movement of
 * an item at an account, only ever added; a correction is another movement. `source_key` makes a
 * person's entry, a count or an imported row move stock once; fulfilment moves only what its line
 * hasn't moved yet, so it needs none.
 */
export const stockMovements = cell
  .table(
    'stock_movements',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').notNull(),
      accountId: uuid('account_id').notNull(),
      itemId: uuid('item_id').notNull(),
      kind: stockMovementKind('kind').notNull(),
      /** Signed base units: in positive, out negative. */
      units: numeric('units', { precision: 18, scale: 3 }).notNull(),
      /** The day it counts on, on the tenant's clock. */
      occurredOn: date('occurred_on').notNull(),
      sourceType: stockSourceType('source_type').notNull(),
      /** The order, count or entry it came from. */
      sourceId: uuid('source_id'),
      /** The order line a fulfilment moved, whose moved units are summed. */
      sourceLineId: uuid('source_line_id'),
      sourceKey: text('source_key'),
      note: text('note'),
      createdBy: uuid('created_by'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('stock_movements_tenant_account_item').on(
        table.tenantId,
        table.accountId,
        table.itemId,
        table.createdAt,
      ),
      index('stock_movements_tenant_occurred').on(table.tenantId, table.occurredOn),
      index('stock_movements_tenant_line')
        .on(table.tenantId, table.sourceLineId)
        .where(sql`${table.sourceLineId} is not null`),
      uniqueIndex('stock_movements_tenant_source_key')
        .on(table.tenantId, table.sourceKey)
        .where(sql`${table.sourceKey} is not null`),
      foreignKey({
        name: 'stock_movements_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      foreignKey({
        name: 'stock_movements_item_fk',
        columns: [table.tenantId, table.itemId],
        foreignColumns: [items.tenantId, items.id],
      }),
      foreignKey({
        name: 'stock_movements_user_fk',
        columns: [table.tenantId, table.createdBy],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * What each account holds of each item (BR-62): kept up by every movement in its transaction, or,
 * while the books keep stock, replaced by each level loaded. Phones keep a copy (row versions).
 */
export const stockLevels = cell
  .table(
    'stock_levels',
    {
      tenantId: uuid('tenant_id').notNull(),
      accountId: uuid('account_id').notNull(),
      itemId: uuid('item_id').notNull(),
      onHand: numeric('on_hand', { precision: 18, scale: 3 }).notNull(),
      movedAt: timestamp('moved_at', { withTimezone: true }),
      countedOn: date('counted_on'),
      rowVersion: rowVersionColumn(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.accountId, table.itemId] }),
      index('stock_levels_tenant_row_version').on(table.tenantId, table.rowVersion),
      foreignKey({
        name: 'stock_levels_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      foreignKey({
        name: 'stock_levels_item_fk',
        columns: [table.tenantId, table.itemId],
        foreignColumns: [items.tenantId, items.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** A count of an account's stock (BR-62), with the client's ID; it adjusts the ledger at once. */
export const stockCounts = cell
  .table(
    'stock_counts',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').notNull(),
      accountId: uuid('account_id').notNull(),
      countedAt: timestamp('counted_at', { withTimezone: true }).notNull(),
      countedBy: uuid('counted_by'),
      note: text('note'),
      flagged: boolean('flagged').notNull().default(false),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('stock_counts_tenant_account_counted').on(
        table.tenantId,
        table.accountId,
        table.countedAt,
      ),
      foreignKey({
        name: 'stock_counts_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      foreignKey({
        name: 'stock_counts_user_fk',
        columns: [table.tenantId, table.countedBy],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

export const stockCountLines = cell
  .table(
    'stock_count_lines',
    {
      tenantId: uuid('tenant_id').notNull(),
      countId: uuid('count_id').notNull(),
      itemId: uuid('item_id').notNull(),
      counted: numeric('counted', { precision: 18, scale: 3 }).notNull(),
      expected: numeric('expected', { precision: 18, scale: 3 }).notNull(),
      difference: numeric('difference', { precision: 18, scale: 3 }).notNull(),
      flags: stockCountFlag('flags').array().notNull().default([]),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.countId, table.itemId] }),
      foreignKey({
        name: 'stock_count_lines_count_fk',
        columns: [table.tenantId, table.countId],
        foreignColumns: [stockCounts.tenantId, stockCounts.id],
      }),
      foreignKey({
        name: 'stock_count_lines_item_fk',
        columns: [table.tenantId, table.itemId],
        foreignColumns: [items.tenantId, items.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
