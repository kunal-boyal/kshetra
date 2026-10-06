import type { LocalizedNoun } from '@kshetra/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { cell, changeColumns, isolation, rowVersionColumn } from './common';
import { users } from './iam';

/**
 * Geography (spec 5.4, 10.3), owned by the territories module: the tenant's named levels, the
 * tree of territory nodes, its closure, and which users are attached where and when.
 */

/** The tenant's geography levels in order, 1 being the highest, such as Zone → Region → Area. */
export const territoryLevels = cell
  .table(
    'territory_levels',
    {
      tenantId: uuid('tenant_id').notNull(),
      level: integer('level').notNull(),
      key: text('key').notNull(),
      name: jsonb('name').$type<z.output<typeof LocalizedNoun>>().notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.level] }),
      uniqueIndex('territory_levels_tenant_key').on(table.tenantId, table.key),
      check('territory_levels_level_range', sql`${table.level} between 1 and 6`),
      isolation(),
    ],
  )
  .enableRLS();

export const territories = cell
  .table(
    'territories',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      level: integer('level').notNull(),
      parentId: uuid('parent_id'),
      code: text('code').notNull(),
      name: text('name').notNull(),
      ownerUserId: uuid('owner_user_id'),
      active: boolean('active').notNull().default(true),
      rowVersion: rowVersionColumn(),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('territories_tenant_code').on(table.tenantId, table.code),
      index('territories_tenant_parent').on(table.tenantId, table.parentId),
      foreignKey({
        name: 'territories_level_fk',
        columns: [table.tenantId, table.level],
        foreignColumns: [territoryLevels.tenantId, territoryLevels.level],
      }),
      foreignKey({
        name: 'territories_parent_fk',
        columns: [table.tenantId, table.parentId],
        foreignColumns: [table.tenantId, table.id],
      }),
      foreignKey({
        name: 'territories_owner_fk',
        columns: [table.tenantId, table.ownerUserId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Every ancestor and descendant pair of the territory tree, each node paired with itself at
 * depth 0, so "everything under my territories" is one indexed lookup (spec 4.2).
 */
export const territoryClosure = cell
  .table(
    'territory_closure',
    {
      tenantId: uuid('tenant_id').notNull(),
      ancestorId: uuid('ancestor_id').notNull(),
      descendantId: uuid('descendant_id').notNull(),
      depth: integer('depth').notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.ancestorId, table.descendantId] }),
      index('territory_closure_descendant').on(table.tenantId, table.descendantId),
      foreignKey({
        name: 'territory_closure_ancestor_fk',
        columns: [table.tenantId, table.ancestorId],
        foreignColumns: [territories.tenantId, territories.id],
      }),
      foreignKey({
        name: 'territory_closure_descendant_fk',
        columns: [table.tenantId, table.descendantId],
        foreignColumns: [territories.tenantId, territories.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Which territories a user works in, and from when (spec 5.4). `valid_to` is the first day the
 * attachment no longer applies, and null while it lasts. Access decisions use today's
 * attachments; reports for a past period use the ones valid then.
 */
export const userTerritories = cell
  .table(
    'user_territories',
    {
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      territoryId: uuid('territory_id').notNull(),
      validFrom: date('valid_from').notNull(),
      validTo: date('valid_to'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.userId, table.territoryId, table.validFrom] }),
      index('user_territories_territory').on(table.tenantId, table.territoryId),
      foreignKey({
        name: 'user_territories_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'user_territories_territory_fk',
        columns: [table.tenantId, table.territoryId],
        foreignColumns: [territories.tenantId, territories.id],
      }),
      check(
        'user_territories_valid_range',
        sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
      ),
      isolation(),
    ],
  )
  .enableRLS();
