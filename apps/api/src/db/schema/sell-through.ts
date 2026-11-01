import { SELL_THROUGH_FLAGS } from '@thelamp/shared';
import {
  date,
  foreignKey,
  index,
  integer,
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

export const sellThroughFlag = cell.enum('sell_through_flag', SELL_THROUGH_FLAGS);

/**
 * Sell-through by item (BR-53, decision D124): each saved version of an account's monthly stock
 * statement. Versions are only added; the latest for an account and month counts.
 */
export const sellThroughStatements = cell
  .table(
    'sell_through_statements',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      accountId: uuid('account_id').notNull(),
      period: text('period').notNull(),
      version: integer('version').notNull(),
      recordedBy: uuid('recorded_by').notNull(),
      recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
      /** The day it counts on, for whoever recorded it (BR-53). */
      creditedOn: date('credited_on').notNull(),
      value: numeric('value', { precision: 18, scale: 2 }),
      flags: sellThroughFlag('flags').array().notNull().default([]),
      rowVersion: rowVersionColumn(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('sell_through_statements_tenant_account_period_version').on(
        table.tenantId,
        table.accountId,
        table.period,
        table.version,
      ),
      index('sell_through_statements_tenant_period_account').on(
        table.tenantId,
        table.period,
        table.accountId,
      ),
      index('sell_through_statements_tenant_credited').on(
        table.tenantId,
        table.recordedBy,
        table.creditedOn,
      ),
      index('sell_through_statements_tenant_row_version').on(table.tenantId, table.rowVersion),
      foreignKey({
        name: 'sell_through_statements_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      foreignKey({
        name: 'sell_through_statements_user_fk',
        columns: [table.tenantId, table.recordedBy],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** One item's stock in a version, in its base unit, with what it sold and its value. */
export const sellThroughLines = cell
  .table(
    'sell_through_lines',
    {
      tenantId: uuid('tenant_id').notNull(),
      statementId: uuid('statement_id').notNull(),
      itemId: uuid('item_id').notNull(),
      opening: numeric('opening', { precision: 18, scale: 3 }).notNull(),
      received: numeric('received', { precision: 18, scale: 3 }).notNull(),
      returned: numeric('returned', { precision: 18, scale: 3 }).notNull(),
      closing: numeric('closing', { precision: 18, scale: 3 }).notNull(),
      sold: numeric('sold', { precision: 18, scale: 3 }).notNull(),
      unitPrice: numeric('unit_price', { precision: 18, scale: 2 }),
      value: numeric('value', { precision: 18, scale: 2 }),
      flags: sellThroughFlag('flags').array().notNull().default([]),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.statementId, table.itemId] }),
      foreignKey({
        name: 'sell_through_lines_statement_fk',
        columns: [table.tenantId, table.statementId],
        foreignColumns: [sellThroughStatements.tenantId, sellThroughStatements.id],
      }),
      foreignKey({
        name: 'sell_through_lines_item_fk',
        columns: [table.tenantId, table.itemId],
        foreignColumns: [items.tenantId, items.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
