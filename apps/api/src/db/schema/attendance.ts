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
import { cell, isolation, rowVersionColumn } from './common';
import { users } from './iam';

/**
 * Holiday calendars and regularisation (M13, spec 5.10, decision D80), owned by the field module
 * beside attendance days: calendars of weekly offs and dated holidays, and requests to count a
 * past day as present.
 */

export const calendars = cell
  .table(
    'calendars',
    {
      tenantId: uuid('tenant_id').notNull(),
      key: text('key').notNull(),
      name: jsonb('name').$type<{ en: string; hi: string }>().notNull(),
      /** ISO weekdays: 1 is Monday, 7 is Sunday. */
      weeklyOffs: integer('weekly_offs')
        .array()
        .notNull()
        .default(sql`'{}'::integer[]`),
      isDefault: boolean('is_default').notNull().default(false),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.key] }),
      uniqueIndex('calendars_tenant_default')
        .on(table.tenantId)
        .where(sql`${table.isDefault}`),
      isolation(),
    ],
  )
  .enableRLS();

export const holidays = cell
  .table(
    'holidays',
    {
      tenantId: uuid('tenant_id').notNull(),
      calendarKey: text('calendar_key').notNull(),
      date: date('date').notNull(),
      name: text('name').notNull(),
      optional: boolean('optional').notNull().default(false),
      /** Off the calendar; kept, as nothing is deleted. */
      active: boolean('active').notNull().default(true),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.calendarKey, table.date] }),
      foreignKey({
        name: 'holidays_calendar_fk',
        columns: [table.tenantId, table.calendarKey],
        foreignColumns: [calendars.tenantId, calendars.key],
      }),
      isolation(),
    ],
  )
  .enableRLS();

export const regularisations = cell
  .table(
    'regularisations',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      date: date('date').notNull(),
      status: text('status').notNull(),
      reason: text('reason').notNull(),
      state: text('state').notNull().default('pending'),
      workflowInstanceId: uuid('workflow_instance_id'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      decidedAt: timestamp('decided_at', { withTimezone: true }),
      rowVersion: rowVersionColumn(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      // BR-28: one request a day that is waiting or approved.
      uniqueIndex('regularisations_one_open')
        .on(table.tenantId, table.userId, table.date)
        .where(sql`${table.state} in ('pending', 'approved')`),
      index('regularisations_tenant_user_date').on(table.tenantId, table.userId, table.date),
      foreignKey({
        name: 'regularisations_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      check('regularisations_status', sql`${table.status} in ('present', 'half_day')`),
      check(
        'regularisations_state',
        sql`${table.state} in ('pending', 'approved', 'rejected', 'cancelled')`,
      ),
      isolation(),
    ],
  )
  .enableRLS();
