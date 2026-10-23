import type { CustomField } from '@thelamp/forms';
import { type CatalogueUnitView, MEASURE_TYPES } from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cell, changeColumns, isolation, rowVersionColumn } from './common';

/**
 * The catalogue (spec 5.11, 10.3), owned by the catalogue module: the tenant's units and item
 * fields, categories, products, and the items sold with the units they come in. Prices and price
 * lists join in phase 2 (decision D38).
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
