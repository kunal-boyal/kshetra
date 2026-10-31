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
import { cell, isolation } from './common';
import { users } from './iam';

/**
 * Leave (M13, spec 5.10, BR-27, decision D81), owned by the leave module: the tenant's leave
 * types, keyed as configuration names them, and people's requests through the `leave` chain.
 */

export const leaveTypes = cell
  .table(
    'leave_types',
    {
      tenantId: uuid('tenant_id').notNull(),
      key: text('key').notNull(),
      name: jsonb('name').$type<{ en: string; hi: string }>().notNull(),
      paid: boolean('paid').notNull(),
      /** Days per quota year; 0 means the type has no quota. */
      annualQuota: numeric('annual_quota', { precision: 5, scale: 1 }).notNull(),
      quotaYear: text('quota_year').notNull(),
      halfDayAllowed: boolean('half_day_allowed').notNull(),
      attachmentAfterDays: integer('attachment_after_days'),
      active: boolean('active').notNull().default(true),
      /** `yearly` (the whole quota on the year's first day) or `monthly` (D114). */
      accrual: text('accrual').notNull().default('yearly'),
      /** Unused days carried into the next quota year, at most (D114). */
      carryForwardMax: numeric('carry_forward_max', { precision: 5, scale: 1 })
        .notNull()
        .default('0'),
      /** Its place in the list, as configuration orders it. */
      position: integer('position').notNull().default(0),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.key] }),
      check('leave_types_quota_year', sql`${table.quotaYear} in ('calendar', 'financial')`),
      check('leave_types_accrual', sql`${table.accrual} in ('yearly', 'monthly')`),
      isolation(),
    ],
  )
  .enableRLS();

export const leaveRequests = cell
  .table(
    'leave_requests',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      leaveTypeKey: text('leave_type_key').notNull(),
      startDate: date('start_date').notNull(),
      endDate: date('end_date').notNull(),
      halfDay: boolean('half_day').notNull().default(false),
      /** Working days, as BR-27 counted them when the request was made. */
      days: numeric('days', { precision: 5, scale: 1 }).notNull(),
      reason: text('reason'),
      attachmentId: uuid('attachment_id'),
      state: text('state').notNull().default('pending'),
      workflowInstanceId: uuid('workflow_instance_id'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      decidedAt: timestamp('decided_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('leave_requests_tenant_user_dates').on(
        table.tenantId,
        table.userId,
        table.startDate,
        table.endDate,
      ),
      index('leave_requests_tenant_dates').on(table.tenantId, table.startDate),
      foreignKey({
        name: 'leave_requests_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'leave_requests_type_fk',
        columns: [table.tenantId, table.leaveTypeKey],
        foreignColumns: [leaveTypes.tenantId, leaveTypes.key],
      }),
      check('leave_requests_range', sql`${table.endDate} >= ${table.startDate}`),
      check(
        'leave_requests_state',
        sql`${table.state} in ('pending', 'approved', 'rejected', 'cancelled')`,
      ),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Closed quota years (D114): for a type that carries days forward, each person's year as it stood
 * when it ended: credited, carried in, taken, carried out and lapsed, with the cap in force then,
 * so later changes to the type never rewrite it. A decision that changes a closed year closes it
 * and the years after it again.
 */
export const leaveYearClosings = cell
  .table(
    'leave_year_closings',
    {
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      leaveTypeKey: text('leave_type_key').notNull(),
      yearFrom: date('year_from').notNull(),
      yearTo: date('year_to').notNull(),
      credited: numeric('credited', { precision: 6, scale: 1 }).notNull(),
      carriedIn: numeric('carried_in', { precision: 6, scale: 1 }).notNull(),
      taken: numeric('taken', { precision: 6, scale: 1 }).notNull(),
      carriedOut: numeric('carried_out', { precision: 6, scale: 1 }).notNull(),
      lapsed: numeric('lapsed', { precision: 6, scale: 1 }).notNull(),
      cap: numeric('cap', { precision: 5, scale: 1 }).notNull(),
      closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({
        columns: [table.tenantId, table.userId, table.leaveTypeKey, table.yearFrom],
      }),
      foreignKey({
        name: 'leave_year_closings_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'leave_year_closings_type_fk',
        columns: [table.tenantId, table.leaveTypeKey],
        foreignColumns: [leaveTypes.tenantId, leaveTypes.key],
      }),
      check('leave_year_closings_range', sql`${table.yearTo} >= ${table.yearFrom}`),
      isolation(),
    ],
  )
  .enableRLS();
