import type { CustomField } from '@thelamp/forms';
import {
  DATA_SCOPES,
  type LocalizedNoun,
  type LocalizedText,
  TRANSFER_STATUSES,
  USER_STATUSES,
} from '@thelamp/shared';
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
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { cell, changeColumns, isolation, rowVersionColumn } from './common';

/**
 * People and access (spec 4.2, 5.3, 10.3), owned by the IAM module. Every table leads its keys
 * with `tenant_id`, and references between them carry it too, so a row can never point into
 * another tenant, even though foreign-key checks bypass row-level security.
 */

export const dataScope = cell.enum('data_scope', DATA_SCOPES);
export const userStatus = cell.enum('user_status', USER_STATUSES);
export const devicePlatform = cell.enum('device_platform', ['android', 'ios', 'web']);
export const transferStatus = cell.enum('transfer_status', TRANSFER_STATUSES);

export const roles = cell
  .table(
    'roles',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      key: text('key').notNull(),
      name: jsonb('name').$type<z.output<typeof LocalizedText>>().notNull(),
      permissions: text('permissions').array().notNull(),
      scope: dataScope('scope').notNull(),
      mobileOnly: boolean('mobile_only').notNull().default(false),
      system: boolean('system').notNull().default(false),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('roles_tenant_key').on(table.tenantId, table.key),
      isolation(),
    ],
  )
  .enableRLS();

export const designations = cell
  .table(
    'designations',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      key: text('key').notNull(),
      name: jsonb('name').$type<z.output<typeof LocalizedNoun>>().notNull(),
      level: integer('level').notNull(),
      defaultRoleId: uuid('default_role_id').notNull(),
      canHaveReports: boolean('can_have_reports').notNull(),
      ranked: boolean('ranked').notNull().default(false),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('designations_tenant_key').on(table.tenantId, table.key),
      foreignKey({
        name: 'designations_default_role_fk',
        columns: [table.tenantId, table.defaultRoleId],
        foreignColumns: [roles.tenantId, roles.id],
      }),
      check('designations_level_range', sql`${table.level} between 1 and 10`),
      isolation(),
    ],
  )
  .enableRLS();

export const users = cell
  .table(
    'users',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      code: text('code').notNull(),
      name: text('name').notNull(),
      // Users who never sign in may have none (D11).
      phoneE164: text('phone_e164'),
      email: text('email'),
      designationId: uuid('designation_id').notNull(),
      roleId: uuid('role_id').notNull(),
      managerId: uuid('manager_id'),
      joiningDate: date('joining_date'),
      exitDate: date('exit_date'),
      /** The holiday calendar the person keeps (M13); null keeps the tenant's default. */
      calendarKey: text('calendar_key'),
      status: userStatus('status').notNull().default('active'),
      // Moves with every change that must sign the user out (BR-39).
      authRevision: integer('auth_revision').notNull().default(0),
      custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
      rowVersion: rowVersionColumn(),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('users_tenant_code').on(table.tenantId, table.code),
      uniqueIndex('users_tenant_phone').on(table.tenantId, table.phoneE164),
      index('users_tenant_manager').on(table.tenantId, table.managerId),
      index('users_tenant_row_version').on(table.tenantId, table.rowVersion),
      foreignKey({
        name: 'users_designation_fk',
        columns: [table.tenantId, table.designationId],
        foreignColumns: [designations.tenantId, designations.id],
      }),
      foreignKey({
        name: 'users_role_fk',
        columns: [table.tenantId, table.roleId],
        foreignColumns: [roles.tenantId, roles.id],
      }),
      foreignKey({
        name: 'users_manager_fk',
        columns: [table.tenantId, table.managerId],
        foreignColumns: [table.tenantId, table.id],
      }),
      check('users_not_own_manager', sql`${table.managerId} <> ${table.id}`),
      check(
        'users_exit_after_joining',
        sql`${table.exitDate} is null or ${table.joiningDate} is null or ${table.exitDate} >= ${table.joiningDate}`,
      ),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Every ancestor and descendant pair in the reporting tree, including each user paired with
 * themselves at depth 0, so "my team" is one indexed lookup (spec 4.2). It is derived from
 * `users.manager_id` and rebuilt from it when a manager changes.
 */
export const reportingClosure = cell
  .table(
    'reporting_closure',
    {
      tenantId: uuid('tenant_id').notNull(),
      ancestorId: uuid('ancestor_id').notNull(),
      descendantId: uuid('descendant_id').notNull(),
      depth: integer('depth').notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.ancestorId, table.descendantId] }),
      index('reporting_closure_descendant').on(table.tenantId, table.descendantId),
      foreignKey({
        name: 'reporting_closure_ancestor_fk',
        columns: [table.tenantId, table.ancestorId],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'reporting_closure_descendant_fk',
        columns: [table.tenantId, table.descendantId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * A phone a user signed in on (spec 10.3). With device binding on, a user has one unrevoked
 * device until a manager or an admin resets it (BR-38). Web sessions have no device.
 */
export const devices = cell
  .table(
    'devices',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      // SHA-256 of the key the app keeps in its secure store; the key itself is never stored.
      deviceKeyHash: text('device_key_hash').notNull(),
      platform: devicePlatform('platform').notNull(),
      model: text('model'),
      osVersion: text('os_version'),
      appVersion: text('app_version'),
      pushToken: text('push_token'),
      integrityVerdict: text('integrity_verdict'),
      health: jsonb('health').$type<Record<string, unknown>>(),
      boundAt: timestamp('bound_at', { withTimezone: true }),
      lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
      revokedAt: timestamp('revoked_at', { withTimezone: true }),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('devices_tenant_user_key').on(table.tenantId, table.userId, table.deviceKeyHash),
      foreignKey({
        name: 'devices_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * The tenant's custom user fields (spec 5.3): those in use, in order, and the retired ones, whose
 * keys stay taken with their types. One row per tenant, written when it first defines a field.
 */
export const userFields = cell
  .table(
    'user_fields',
    {
      tenantId: uuid('tenant_id').notNull(),
      fields: jsonb('fields').$type<CustomField[]>().notNull().default([]),
      retired: jsonb('retired').$type<CustomField[]>().notNull().default([]),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      updatedBy: uuid('updated_by'),
    },
    (table) => [primaryKey({ columns: [table.tenantId] }), isolation()],
  )
  .enableRLS();

/** What a transfer changes. Managers and territories by ID, designations and roles by key. */
export interface TransferChanges {
  managerId?: string | null;
  designation?: string;
  role?: string;
  territoryIds?: string[];
}

/**
 * Moves to another manager, designation, role or territories from a date on (M3). A transfer
 * dated today applies when it is made; a later one waits as `scheduled` until the tenant's day
 * comes, and its references are checked again then.
 */
export const userTransfers = cell
  .table(
    'user_transfers',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      effectiveDate: date('effective_date').notNull(),
      changes: jsonb('changes').$type<TransferChanges>().notNull(),
      status: transferStatus('status').notNull().default('scheduled'),
      reason: text('reason'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      createdBy: uuid('created_by'),
      appliedAt: timestamp('applied_at', { withTimezone: true }),
      cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
      cancelledBy: uuid('cancelled_by'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('user_transfers_tenant_user').on(table.tenantId, table.userId, table.effectiveDate),
      index('user_transfers_due')
        .on(table.tenantId, table.effectiveDate)
        .where(sql`${table.status} = 'scheduled'`),
      foreignKey({
        name: 'user_transfers_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Each stretch of time a person was active (BR-45, decision D89): opened when they are added or
 * reactivated, closed when deactivated, in the same transaction. Billable seats for a period are
 * read from here; vendor staff are never users, so never seats.
 */
export const seatIntervals = cell
  .table(
    'seat_intervals',
    {
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      activeFrom: timestamp('active_from', { withTimezone: true }).notNull(),
      activeTo: timestamp('active_to', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.userId, table.activeFrom] }),
      index('seat_intervals_tenant_period').on(table.tenantId, table.activeFrom, table.activeTo),
      // At most one open stretch a person.
      uniqueIndex('seat_intervals_one_open')
        .on(table.tenantId, table.userId)
        .where(sql`${table.activeTo} is null`),
      foreignKey({
        name: 'seat_intervals_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * A tenant's API clients (spec 10.3, module M20, decision D94): systems such as an ERP that call
 * the API with OAuth 2.0 client credentials. The client ID is public and names the tenant; the
 * secret is kept as a SHA-256 hash of its 32 random bytes. Scopes say what it may do; revoking it
 * or rotating its secret moves its auth revision, so tokens issued before stop working.
 */
export const apiClients = cell
  .table(
    'api_clients',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      name: text('name').notNull(),
      clientId: text('client_id').notNull(),
      secretHash: text('secret_hash').notNull(),
      scopes: text('scopes').array().notNull(),
      status: text('status').notNull().default('active'),
      authRevision: integer('auth_revision').notNull().default(0),
      lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
      revokedAt: timestamp('revoked_at', { withTimezone: true }),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('api_clients_tenant_client_id').on(table.tenantId, table.clientId),
      isolation(),
    ],
  )
  .enableRLS();
