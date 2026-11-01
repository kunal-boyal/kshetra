import {
  boolean,
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

/**
 * Product forecasts per account (BR-54, decision D126): each saved version of an account's
 * forecast for a month. Versions are only added; the latest for an account and month counts.
 */
export const forecasts = cell
  .table(
    'forecasts',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      accountId: uuid('account_id').notNull(),
      period: text('period').notNull(),
      version: integer('version').notNull(),
      recordedBy: uuid('recorded_by').notNull(),
      recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
      /** Why it changed a month after its lock (BR-54). */
      reason: text('reason'),
      afterLock: boolean('after_lock').notNull().default(false),
      rowVersion: rowVersionColumn(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('forecasts_tenant_account_period_version').on(
        table.tenantId,
        table.accountId,
        table.period,
        table.version,
      ),
      index('forecasts_tenant_period_account').on(table.tenantId, table.period, table.accountId),
      index('forecasts_tenant_row_version').on(table.tenantId, table.rowVersion),
      foreignKey({
        name: 'forecasts_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      foreignKey({
        name: 'forecasts_user_fk',
        columns: [table.tenantId, table.recordedBy],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** One item's quantity in a version, in its base unit. */
export const forecastLines = cell
  .table(
    'forecast_lines',
    {
      tenantId: uuid('tenant_id').notNull(),
      forecastId: uuid('forecast_id').notNull(),
      itemId: uuid('item_id').notNull(),
      quantity: numeric('quantity', { precision: 18, scale: 3 }).notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.forecastId, table.itemId] }),
      foreignKey({
        name: 'forecast_lines_forecast_fk',
        columns: [table.tenantId, table.forecastId],
        foreignColumns: [forecasts.tenantId, forecasts.id],
      }),
      foreignKey({
        name: 'forecast_lines_item_fk',
        columns: [table.tenantId, table.itemId],
        foreignColumns: [items.tenantId, items.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
