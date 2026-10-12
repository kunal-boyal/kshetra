import type { AccountType } from '@kshetra/forms';
import {
  ACCOUNT_STATUSES,
  type AccountAddress,
  LOCATION_STATUSES,
  PROPOSAL_STATUSES,
} from '@kshetra/shared';
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
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cell, changeColumns, geographyPoint, isolation, rowVersionColumn } from './common';
import { users } from './iam';
import { territories } from './territories';
import { workflowInstances } from './workflow';

/**
 * Accounts (spec 5.5, 10.3), owned by the accounts module: the tenant's account types with their
 * versioned definitions, the accounts themselves, who fills their slots and when, their contacts,
 * and the locations proposed from the field.
 */

export const accountStatus = cell.enum('account_status', ACCOUNT_STATUSES);
export const locationStatus = cell.enum('location_status', LOCATION_STATUSES);
export const proposalStatus = cell.enum('proposal_status', PROPOSAL_STATUSES);

export const accountTypes = cell
  .table(
    'account_types',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      key: text('key').notNull(),
      currentVersion: integer('current_version').notNull(),
      active: boolean('active').notNull().default(true),
      /** The next number of a type that numbers its accounts. */
      nextNumber: integer('next_number').notNull().default(1),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('account_types_tenant_key').on(table.tenantId, table.key),
      isolation(),
    ],
  )
  .enableRLS();

/** Every published definition of a type; accounts and submissions keep the version they used. */
export const accountTypeVersions = cell
  .table(
    'account_type_versions',
    {
      tenantId: uuid('tenant_id').notNull(),
      accountTypeId: uuid('account_type_id').notNull(),
      version: integer('version').notNull(),
      definition: jsonb('definition').$type<AccountType>().notNull(),
      publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
      publishedBy: uuid('published_by'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.accountTypeId, table.version] }),
      foreignKey({
        name: 'account_type_versions_type_fk',
        columns: [table.tenantId, table.accountTypeId],
        foreignColumns: [accountTypes.tenantId, accountTypes.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

export const accounts = cell
  .table(
    'accounts',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      typeId: uuid('type_id').notNull(),
      code: text('code').notNull(),
      name: text('name').notNull(),
      territoryId: uuid('territory_id').notNull(),
      parentAccountId: uuid('parent_account_id'),
      address: jsonb('address').$type<AccountAddress>().notNull().default({}),
      location: geographyPoint('location'),
      geofenceRadiusM: integer('geofence_radius_m'),
      locationStatus: locationStatus('location_status').notNull().default('unverified'),
      status: accountStatus('status').notNull(),
      segments: text('segments')
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
      rowVersion: rowVersionColumn(),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('accounts_tenant_code').on(table.tenantId, table.code),
      index('accounts_tenant_territory').on(table.tenantId, table.territoryId),
      index('accounts_tenant_type_name').on(table.tenantId, table.typeId, table.name),
      index('accounts_tenant_row_version').on(table.tenantId, table.rowVersion),
      index('accounts_location').using('gist', table.location),
      index('accounts_name_trgm').using('gin', table.name.op('gin_trgm_ops')),
      foreignKey({
        name: 'accounts_type_fk',
        columns: [table.tenantId, table.typeId],
        foreignColumns: [accountTypes.tenantId, accountTypes.id],
      }),
      foreignKey({
        name: 'accounts_territory_fk',
        columns: [table.tenantId, table.territoryId],
        foreignColumns: [territories.tenantId, territories.id],
      }),
      foreignKey({
        name: 'accounts_parent_fk',
        columns: [table.tenantId, table.parentAccountId],
        foreignColumns: [table.tenantId, table.id],
      }),
      check(
        'accounts_geofence_range',
        sql`${table.geofenceRadiusM} is null or ${table.geofenceRadiusM} between 50 and 5000`,
      ),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Who fills each slot of an account, and from when (spec 5.5). `valid_to` is the first day the
 * holder no longer fills it, and null while they do. Visibility follows today's holders; visits
 * stay with the people who made them.
 */
export const accountSlots = cell
  .table(
    'account_slots',
    {
      tenantId: uuid('tenant_id').notNull(),
      accountId: uuid('account_id').notNull(),
      slotKey: text('slot_key').notNull(),
      userId: uuid('user_id').notNull(),
      validFrom: date('valid_from').notNull(),
      validTo: date('valid_to'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.accountId, table.slotKey, table.validFrom] }),
      index('account_slots_user').on(table.tenantId, table.userId),
      foreignKey({
        name: 'account_slots_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      foreignKey({
        name: 'account_slots_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      check(
        'account_slots_valid_range',
        sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
      ),
      isolation(),
    ],
  )
  .enableRLS();

export const contacts = cell
  .table(
    'contacts',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      accountId: uuid('account_id').notNull(),
      name: text('name').notNull(),
      role: text('role'),
      phone: text('phone'),
      email: text('email'),
      custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
      active: boolean('active').notNull().default(true),
      rowVersion: rowVersionColumn(),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('contacts_tenant_account').on(table.tenantId, table.accountId),
      index('contacts_tenant_row_version').on(table.tenantId, table.rowVersion),
      foreignKey({
        name: 'contacts_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** A location a field user proposed for an account, waiting for a decision (M4). */
export const accountLocationProposals = cell
  .table(
    'account_location_proposals',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      accountId: uuid('account_id').notNull(),
      proposedBy: uuid('proposed_by').notNull(),
      point: geographyPoint('point').notNull(),
      accuracy: doublePrecision('accuracy').notNull(),
      capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
      workflowInstanceId: uuid('workflow_instance_id'),
      status: proposalStatus('status').notNull().default('pending'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      decidedAt: timestamp('decided_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('account_location_proposals_account').on(table.tenantId, table.accountId),
      foreignKey({
        name: 'account_location_proposals_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      foreignKey({
        name: 'account_location_proposals_user_fk',
        columns: [table.tenantId, table.proposedBy],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'account_location_proposals_instance_fk',
        columns: [table.tenantId, table.workflowInstanceId],
        foreignColumns: [workflowInstances.tenantId, workflowInstances.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
