import type { CustomField } from '@thelamp/forms';
import { type CatalogueUnitView, MEASURE_TYPES, PRICE_LIST_SCOPES } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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
import { cell, changeColumns, isolation, rowVersionColumn } from './common';

/**
 * The catalogue (spec 5.11, 10.3), owned by the catalogue module: the tenant's units and item
 * fields, categories, products, the items sold with the units they come in, and the price lists
 * that price them (decision D77).
 */

export const measureType = cell.enum('measure_type', MEASURE_TYPES);

/** The tenant's catalogue settings, from its template; `version` moves with every change. */
export const catalogueSettings = cell
  .table(
    'catalogue_settings',
    {
      tenantId: uuid('tenant_id').notNull().primaryKey(),
      units: jsonb('units').$type<CatalogueUnitView[]>().notNull(),
      measureTypes: text('measure_types')
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      rounding: text('rounding').notNull().default('per_unit_first'),
      itemFields: jsonb('item_fields').$type<CustomField[]>().notNull().default([]),
      rejectionReasons: jsonb('rejection_reasons').notNull().default([]),
      version: integer('version').notNull().default(1),
    },
    () => [isolation()],
  )
  .enableRLS();

export const productCategories = cell
  .table(
    'product_categories',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      parentId: uuid('parent_id'),
      name: text('name').notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('product_categories_tenant_name').on(table.tenantId, sql`lower(${table.name})`),
      foreignKey({
        name: 'product_categories_parent_fk',
        columns: [table.tenantId, table.parentId],
        foreignColumns: [table.tenantId, table.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

export const products = cell
  .table(
    'products',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      categoryId: uuid('category_id'),
      name: text('name').notNull(),
      custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('products_tenant_name').on(table.tenantId, sql`lower(${table.name})`),
      foreignKey({
        name: 'products_category_fk',
        columns: [table.tenantId, table.categoryId],
        foreignColumns: [productCategories.tenantId, productCategories.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

export const items = cell
  .table(
    'items',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      productId: uuid('product_id').notNull(),
      code: text('code').notNull(),
      name: text('name').notNull(),
      packLabel: text('pack_label'),
      hsn: text('hsn'),
      taxRate: numeric('tax_rate', { precision: 7, scale: 4 }).notNull(),
      mrp: numeric('mrp', { precision: 18, scale: 2 }),
      baseUnit: text('base_unit').notNull(),
      measureType: measureType('measure_type'),
      measurePerBaseUnit: numeric('measure_per_base_unit', { precision: 18, scale: 6 }),
      custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
      active: boolean('active').notNull().default(true),
      rowVersion: rowVersionColumn(),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('items_tenant_code').on(table.tenantId, sql`lower(${table.code})`),
      index('items_tenant_product').on(table.tenantId, table.productId),
      foreignKey({
        name: 'items_product_fk',
        columns: [table.tenantId, table.productId],
        foreignColumns: [products.tenantId, products.id],
      }),
      check('items_tax_rate_range', sql`${table.taxRate} between 0 and 100`),
      check(
        'items_measure_pair',
        sql`(${table.measureType} is null) = (${table.measurePerBaseUnit} is null)`,
      ),
      isolation(),
    ],
  )
  .enableRLS();

/** The units an item comes in, with how many base units each holds; the base unit holds 1. */
export const itemUnits = cell
  .table(
    'item_units',
    {
      tenantId: uuid('tenant_id').notNull(),
      itemId: uuid('item_id').notNull(),
      unitKey: text('unit_key').notNull(),
      factor: numeric('factor', { precision: 18, scale: 3 }).notNull(),
      sellable: boolean('sellable').notNull().default(true),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.itemId, table.unitKey] }),
      foreignKey({
        name: 'item_units_item_fk',
        columns: [table.tenantId, table.itemId],
        foreignColumns: [items.tenantId, items.id],
      }),
      check('item_units_factor_positive', sql`${table.factor} > 0`),
      isolation(),
    ],
  )
  .enableRLS();

export const priceListScope = cell.enum('price_list_scope', PRICE_LIST_SCOPES);

/**
 * A price list (spec 5.11): who it is for, its priority among lists as specific, and the dates it
 * applies on, both included. `version` moves with every change to the list or its entries, for
 * editing on the version the editor saw.
 */
export const priceLists = cell
  .table(
    'price_lists',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      name: text('name').notNull(),
      scope: priceListScope('scope').notNull(),
      /** Account type keys, segment keys, territory IDs or account IDs; empty for a default list. */
      targets: text('targets')
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      priority: integer('priority').notNull().default(0),
      validFrom: date('valid_from').notNull(),
      validTo: date('valid_to'),
      active: boolean('active').notNull().default(true),
      version: integer('version').notNull().default(1),
      rowVersion: rowVersionColumn(),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('price_lists_tenant_name').on(table.tenantId, sql`lower(${table.name})`),
      check(
        'price_lists_valid_dates',
        sql`${table.validTo} is null or ${table.validTo} >= ${table.validFrom}`,
      ),
      check(
        'price_lists_default_targets',
        sql`(${table.scope} = 'default') = (cardinality(${table.targets}) = 0)`,
      ),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * An item's price per base unit and discount on a list. A removed entry keeps its row with
 * `removed_at` set, so phones learn of the removal and nothing is deleted.
 */
export const priceListItems = cell
  .table(
    'price_list_items',
    {
      /** For the phones' sync, which keys rows by one UUID. */
      id: uuid('id')
        .notNull()
        .default(sql`uuidv7()`),
      tenantId: uuid('tenant_id').notNull(),
      priceListId: uuid('price_list_id').notNull(),
      itemId: uuid('item_id').notNull(),
      price: numeric('price', { precision: 18, scale: 2 }).notNull(),
      discount: numeric('discount', { precision: 7, scale: 4 }).notNull().default('0'),
      removedAt: timestamp('removed_at', { withTimezone: true }),
      rowVersion: rowVersionColumn(),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.priceListId, table.itemId] }),
      uniqueIndex('price_list_items_tenant_id').on(table.tenantId, table.id),
      index('price_list_items_tenant_item').on(table.tenantId, table.itemId),
      index('price_list_items_tenant_row_version').on(table.tenantId, table.rowVersion),
      foreignKey({
        name: 'price_list_items_list_fk',
        columns: [table.tenantId, table.priceListId],
        foreignColumns: [priceLists.tenantId, priceLists.id],
      }),
      foreignKey({
        name: 'price_list_items_item_fk',
        columns: [table.tenantId, table.itemId],
        foreignColumns: [items.tenantId, items.id],
      }),
      check('price_list_items_price', sql`${table.price} >= 0`),
      check('price_list_items_discount', sql`${table.discount} between 0 and 100`),
      isolation(),
    ],
  )
  .enableRLS();
