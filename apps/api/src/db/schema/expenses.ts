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
  uuid,
} from 'drizzle-orm/pg-core';
import type { ExpensePolicy } from '@thelamp/shared';
import { cell, isolation } from './common';
import { users } from './iam';

/**
 * Expenses (M12, spec 5.10, BR-29, BR-30, decision D83), owned by the expenses module: policies
 * keyed as configuration names them, each change a version from a day, and claims that keep the
 * version in force on their day. Receipts and odometer photos are media owned by their claim.
 */

export const expensePolicies = cell
  .table(
    'expense_policies',
    {
      tenantId: uuid('tenant_id').notNull(),
      key: text('key').notNull(),
      /** The latest version; claims find theirs by day. */
      currentVersion: integer('current_version').notNull(),
      active: boolean('active').notNull().default(true),
      /** Its place in the list, as configuration orders it. */
      position: integer('position').notNull().default(0),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [primaryKey({ columns: [table.tenantId, table.key] }), isolation()],
  )
  .enableRLS();

export const expensePolicyVersions = cell
  .table(
    'expense_policy_versions',
    {
      tenantId: uuid('tenant_id').notNull(),
      policyKey: text('policy_key').notNull(),
      version: integer('version').notNull(),
      definition: jsonb('definition').$type<ExpensePolicy>().notNull(),
      validFrom: date('valid_from').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.policyKey, table.version] }),
      index('expense_policy_versions_from').on(table.tenantId, table.policyKey, table.validFrom),
      foreignKey({
        name: 'expense_policy_versions_policy_fk',
        columns: [table.tenantId, table.policyKey],
        foreignColumns: [expensePolicies.tenantId, expensePolicies.key],
      }),
      isolation(),
    ],
  )
  .enableRLS();

export const expenseClaims = cell
  .table(
    'expense_claims',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      policyKey: text('policy_key').notNull(),
      policyVersion: integer('policy_version').notNull(),
      expenseDate: date('expense_date').notNull(),
      description: text('description').notNull(),
      /** Kilometres, days or visits; null for a bill. */
      quantity: numeric('quantity', { precision: 18, scale: 3 }),
      rate: numeric('rate', { precision: 18, scale: 2 }),
      odometerOpen: numeric('odometer_open', { precision: 12, scale: 1 }),
      odometerClose: numeric('odometer_close', { precision: 12, scale: 1 }),
      /**
       * The shift whose punch readings and photos a per-km claim began from (decision D99), and
       * whether the person changed a reading from the shift's, which the approver sees.
       */
      shiftId: uuid('shift_id'),
      odometerChanged: boolean('odometer_changed').notNull().default(false),
      /**
       * Per-km claims: the day's tracked kilometres when the claim was made, from the person's
       * ended shifts; null without one (decision D115).
       */
      trackedKm: numeric('tracked_km', { precision: 10, scale: 2 }),
      billAmount: numeric('bill_amount', { precision: 18, scale: 2 }),
      /** Before caps. */
      calculated: numeric('calculated', { precision: 18, scale: 2 }).notNull(),
      /** Claimed, after caps (BR-29). */
      amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
      capped: boolean('capped').notNull().default(false),
      state: text('state').notNull().default('pending'),
      workflowInstanceId: uuid('workflow_instance_id'),
      paidAt: timestamp('paid_at', { withTimezone: true }),
      paidBy: uuid('paid_by'),
      paymentReference: text('payment_reference'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      decidedAt: timestamp('decided_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('expense_claims_tenant_user_date').on(table.tenantId, table.userId, table.expenseDate),
      index('expense_claims_tenant_date').on(table.tenantId, table.expenseDate),
      foreignKey({
        name: 'expense_claims_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'expense_claims_version_fk',
        columns: [table.tenantId, table.policyKey, table.policyVersion],
        foreignColumns: [
          expensePolicyVersions.tenantId,
          expensePolicyVersions.policyKey,
          expensePolicyVersions.version,
        ],
      }),
      check(
        'expense_claims_state',
        sql`${table.state} in ('pending', 'approved', 'rejected', 'cancelled', 'paid')`,
      ),
      isolation(),
    ],
  )
  .enableRLS();
