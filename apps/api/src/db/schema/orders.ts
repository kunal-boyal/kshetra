import { LINE_DECISIONS, ORDER_STATUSES, SUPPLIER_KINDS } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import {
  check,
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
import { items, measureType, priceLists } from './catalogue';
import { cell, geographyPoint, isolation, rowVersionColumn } from './common';
import { users } from './iam';

/**
 * Orders (M10, spec 10.3, decision D78), owned by the orders module: what the field asked for,
 * priced by the server, with each line's item as it was when the order was placed (BR-15).
 */

export const orderStatus = cell.enum('order_status', ORDER_STATUSES);
export const lineDecision = cell.enum('order_line_decision', LINE_DECISIONS);
export const supplierKind = cell.enum('order_supplier_kind', SUPPLIER_KINDS);

export const orders = cell
  .table(
    'orders',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      accountId: uuid('account_id').notNull(),
      supplierKind: supplierKind('supplier_kind').notNull(),
      supplierAccountId: uuid('supplier_account_id'),
      userId: uuid('user_id').notNull(),
      deviceId: uuid('device_id'),
      visitId: uuid('visit_id'),
      shiftId: uuid('shift_id'),
      placedAt: timestamp('placed_at', { withTimezone: true }).notNull(),
      receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
      point: geographyPoint('point'),
      accuracy: doublePrecision('accuracy'),
      subtotal: numeric('subtotal', { precision: 18, scale: 2 }).notNull(),
      taxTotal: numeric('tax_total', { precision: 18, scale: 2 }).notNull(),
      total: numeric('total', { precision: 18, scale: 2 }).notNull(),
      note: text('note'),
      photoIds: uuid('photo_ids')
        .array()
        .notNull()
        .default(sql`'{}'::uuid[]`),
      status: orderStatus('status').notNull().default('submitted'),
      rejectionReason: text('rejection_reason'),
      workflowInstanceId: uuid('workflow_instance_id'),
      version: integer('version').notNull().default(1),
      /** The tenant's short number for the order, from 1001, never reused (decision D104). */
      number: integer('number').notNull(),
      rowVersion: rowVersionColumn(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('orders_tenant_placed').on(table.tenantId, table.placedAt),
      index('orders_tenant_account_placed').on(table.tenantId, table.accountId, table.placedAt),
      index('orders_tenant_user_placed').on(table.tenantId, table.userId, table.placedAt),
      index('orders_tenant_supplier').on(table.tenantId, table.supplierAccountId),
      index('orders_tenant_row_version').on(table.tenantId, table.rowVersion, table.id),
      index('orders_point').using('gist', table.point),
      uniqueIndex('orders_tenant_number').on(table.tenantId, table.number),
      foreignKey({
        name: 'orders_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      foreignKey({
        name: 'orders_supplier_fk',
        columns: [table.tenantId, table.supplierAccountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      foreignKey({
        name: 'orders_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      check(
        'orders_supplier_pair',
        sql`(${table.supplierKind} = 'account') = (${table.supplierAccountId} is not null)`,
      ),
      check('orders_total', sql`${table.total} between 0 and 10000000000`),
      isolation(),
    ],
  )
  .enableRLS();

/** Each tenant's last order number, taken in the placing transaction (decision D104). */
export const orderCounters = cell
  .table(
    'order_counters',
    {
      tenantId: uuid('tenant_id').notNull().primaryKey(),
      last: integer('last').notNull(),
    },
    () => [isolation()],
  )
  .enableRLS();

export const orderLines = cell
  .table(
    'order_lines',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      orderId: uuid('order_id').notNull(),
      position: integer('position').notNull(),
      itemId: uuid('item_id').notNull(),
      /** Code, name, pack, HSN, MRP and base unit when placed (BR-15). */
      snapshot: jsonb('snapshot').notNull(),
      priceListId: uuid('price_list_id').notNull(),
      unitKey: text('unit_key').notNull(),
      quantity: numeric('quantity', { precision: 18, scale: 3 }).notNull(),
      factor: numeric('factor', { precision: 18, scale: 3 }).notNull(),
      baseUnits: numeric('base_units', { precision: 18, scale: 3 }).notNull(),
      measureType: measureType('measure_type'),
      measureTotal: numeric('measure_total', { precision: 18, scale: 3 }),
      price: numeric('price', { precision: 18, scale: 2 }).notNull(),
      discount: numeric('discount', { precision: 7, scale: 4 }).notNull(),
      taxRate: numeric('tax_rate', { precision: 7, scale: 4 }).notNull(),
      rate: numeric('rate', { precision: 18, scale: 2 }).notNull(),
      taxable: numeric('taxable', { precision: 18, scale: 2 }).notNull(),
      tax: numeric('tax', { precision: 18, scale: 2 }).notNull(),
      total: numeric('total', { precision: 18, scale: 2 }).notNull(),
      decision: lineDecision('decision').notNull().default('pending'),
      decisionReason: text('decision_reason'),
      fulfilledUnits: numeric('fulfilled_units', { precision: 18, scale: 3 }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('order_lines_tenant_order').on(table.tenantId, table.orderId, table.position),
      index('order_lines_tenant_item').on(table.tenantId, table.itemId),
      foreignKey({
        name: 'order_lines_order_fk',
        columns: [table.tenantId, table.orderId],
        foreignColumns: [orders.tenantId, orders.id],
      }),
      foreignKey({
        name: 'order_lines_item_fk',
        columns: [table.tenantId, table.itemId],
        foreignColumns: [items.tenantId, items.id],
      }),
      foreignKey({
        name: 'order_lines_price_list_fk',
        columns: [table.tenantId, table.priceListId],
        foreignColumns: [priceLists.tenantId, priceLists.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
