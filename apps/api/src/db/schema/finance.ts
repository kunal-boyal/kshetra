import { COLLECTION_MODES, COLLECTION_STATUSES, RECEIPT_KINDS } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { cell, geographyPoint, isolation, rowVersionColumn } from './common';
import { users } from './iam';

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

export const collectionMode = cell.enum('collection_mode', COLLECTION_MODES);
export const collectionStatus = cell.enum('collection_status', COLLECTION_STATUSES);

/**
 * Collections (M11, BR-63, decision D132): money a person took from an account, with its ID from
 * the phone. They stand beside the books and never become receipts (spec 2.2): `receipt_id` names
 * the books' receipt matched to one, by the rule or by hand. Phones keep a copy (row versions).
 */
export const collections = cell
  .table(
    'collections',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').notNull(),
      number: integer('number').notNull(),
      accountId: uuid('account_id').notNull(),
      userId: uuid('user_id').notNull(),
      deviceId: uuid('device_id'),
      visitId: uuid('visit_id'),
      shiftId: uuid('shift_id'),
      /** The day it was taken on the tenant's clock, and the moment. */
      collectedOn: date('collected_on').notNull(),
      collectedAt: timestamp('collected_at', { withTimezone: true }).notNull(),
      amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
      mode: collectionMode('mode').notNull(),
      reference: text('reference'),
      chequeNumber: text('cheque_number'),
      chequeBank: text('cheque_bank'),
      chequeDate: date('cheque_date'),
      note: text('note'),
      point: geographyPoint('point'),
      accuracy: doublePrecision('accuracy'),
      inGeofence: boolean('in_geofence'),
      status: collectionStatus('status').notNull().default('recorded'),
      /** Why it was rejected or bounced. */
      reason: text('reason'),
      decidedBy: uuid('decided_by'),
      decidedAt: timestamp('decided_at', { withTimezone: true }),
      receiptId: uuid('receipt_id'),
      matchedByHand: boolean('matched_by_hand').notNull().default(false),
      matchedAt: timestamp('matched_at', { withTimezone: true }),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      rowVersion: rowVersionColumn(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('collections_tenant_number').on(table.tenantId, table.number),
      uniqueIndex('collections_tenant_receipt')
        .on(table.tenantId, table.receiptId)
        .where(sql`${table.receiptId} is not null`),
      index('collections_tenant_account_status').on(table.tenantId, table.accountId, table.status),
      index('collections_tenant_user_day').on(table.tenantId, table.userId, table.collectedOn),
      index('collections_tenant_status_day').on(table.tenantId, table.status, table.collectedOn),
      index('collections_tenant_row_version').on(table.tenantId, table.rowVersion, table.id),
      foreignKey({
        name: 'collections_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      foreignKey({
        name: 'collections_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'collections_decided_by_fk',
        columns: [table.tenantId, table.decidedBy],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'collections_receipt_fk',
        columns: [table.tenantId, table.receiptId],
        foreignColumns: [accountReceipts.tenantId, accountReceipts.id],
      }),
      check('collections_amount', sql`${table.amount} > 0`),
      isolation(),
    ],
  )
  .enableRLS();

/** Each tenant's last collection number, locked by its upsert while a collection is recorded. */
export const collectionCounters = cell
  .table(
    'collection_counters',
    {
      tenantId: uuid('tenant_id').notNull().primaryKey(),
      last: integer('last').notNull(),
    },
    () => [isolation()],
  )
  .enableRLS();
