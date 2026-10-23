import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { cell, isolation, rowVersionColumn } from './common';

/**
 * Account finance (M11, spec 10.3, decision D79), owned by the finance module: balance snapshots
 * with their ageing, every one kept, and statement entries, which are only ever added (BR-21).
 */

export const financeSnapshots = cell
  .table(
    'finance_snapshots',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      accountId: uuid('account_id').notNull(),
      asOf: date('as_of').notNull(),
      outstanding: numeric('outstanding', { precision: 18, scale: 2 }).notNull(),
      creditLimit: numeric('credit_limit', { precision: 18, scale: 2 }),
      inventoryValue: numeric('inventory_value', { precision: 18, scale: 2 }),
      ageing: jsonb('ageing').$type<Record<string, string>>().notNull().default({}),
      source: text('source').notNull(),
      importId: uuid('import_id'),
      createdBy: uuid('created_by'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      rowVersion: rowVersionColumn(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('finance_snapshots_tenant_account_as_of').on(
        table.tenantId,
        table.accountId,
        table.asOf.desc(),
        table.createdAt.desc(),
      ),
      index('finance_snapshots_tenant_row_version').on(table.tenantId, table.rowVersion, table.id),
      foreignKey({
        name: 'finance_snapshots_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      check(
        'finance_snapshots_amounts',
        sql`${table.outstanding} >= 0
        and coalesce(${table.creditLimit}, 0) >= 0 and coalesce(${table.inventoryValue}, 0) >= 0`,
      ),
      isolation(),
    ],
  )
  .enableRLS();

export const ledgerEntries = cell
  .table(
    'ledger_entries',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      accountId: uuid('account_id').notNull(),
      date: date('date').notNull(),
      reference: text('reference').notNull(),
      description: text('description'),
      debit: numeric('debit', { precision: 18, scale: 2 }).notNull().default('0'),
      credit: numeric('credit', { precision: 18, scale: 2 }).notNull().default('0'),
      source: text('source').notNull(),
      importId: uuid('import_id'),
      createdBy: uuid('created_by'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('ledger_entries_tenant_reference').on(table.tenantId, table.reference),
      index('ledger_entries_tenant_account_date').on(table.tenantId, table.accountId, table.date),
      foreignKey({
        name: 'ledger_entries_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      check(
        'ledger_entries_one_side',
        sql`${table.debit} >= 0 and ${table.credit} >= 0 and (${table.debit} > 0) <> (${table.credit} > 0)`,
      ),
      isolation(),
    ],
  )
  .enableRLS();
