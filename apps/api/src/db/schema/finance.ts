import { RECEIPT_KINDS } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
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
 * with their ageing, every one kept, and statement entries, which are only ever added (BR-21);
 * and the customer's invoices and receipts (D121).
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

export const receiptKind = cell.enum('receipt_kind', RECEIPT_KINDS);

/**
 * Invoices from the customer's books (M11, BR-51, decision D121), keyed by their number. A
 * document sent again changed is updated, audited; a cancelled one stays, out of the ageing.
 */
export const accountInvoices = cell
  .table(
    'invoices',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      accountId: uuid('account_id').notNull(),
      number: text('number').notNull(),
      date: date('date').notNull(),
      dueDate: date('due_date').notNull(),
      amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
      cancelled: boolean('cancelled').notNull().default(false),
      source: text('source').notNull(),
      importId: uuid('import_id'),
      createdBy: uuid('created_by'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      updatedBy: uuid('updated_by'),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      rowVersion: rowVersionColumn(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('invoices_tenant_number').on(table.tenantId, table.number),
      index('invoices_tenant_account_due').on(table.tenantId, table.accountId, table.dueDate),
      index('invoices_tenant_row_version').on(table.tenantId, table.rowVersion, table.id),
      foreignKey({
        name: 'invoices_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      check('invoices_amount', sql`${table.amount} > 0`),
      check('invoices_due', sql`${table.dueDate} >= ${table.date}`),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Receipts and credit notes from the customer's books (BR-51, D121), keyed by their number,
 * with the invoice numbers each pays; what they don't name settles the oldest open invoices.
 */
export const accountReceipts = cell
  .table(
    'receipts',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      accountId: uuid('account_id').notNull(),
      number: text('number').notNull(),
      date: date('date').notNull(),
      amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
      kind: receiptKind('kind').notNull().default('receipt'),
      against: text('against')
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      cancelled: boolean('cancelled').notNull().default(false),
      source: text('source').notNull(),
      importId: uuid('import_id'),
      createdBy: uuid('created_by'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      updatedBy: uuid('updated_by'),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      rowVersion: rowVersionColumn(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('receipts_tenant_number').on(table.tenantId, table.number),
      index('receipts_tenant_account_date').on(table.tenantId, table.accountId, table.date),
      index('receipts_tenant_row_version').on(table.tenantId, table.rowVersion, table.id),
      foreignKey({
        name: 'receipts_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      check('receipts_amount', sql`${table.amount} > 0`),
      isolation(),
    ],
  )
  .enableRLS();
