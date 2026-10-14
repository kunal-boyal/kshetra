import { PLAN_ITEM_STATUSES, PLAN_STATUSES, type RouteRecurrence } from '@kshetra/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { accounts } from './accounts';
import { cell, isolation, rowVersionColumn } from './common';
import { visits } from './field';
import { users } from './iam';

/**
 * Journey plans (M8, spec 10.3), owned by the planning module: each person's routes, the plan
 * items made from them or by hand, and, where the tenant asks for it, each month's approval.
 */

export const planItemStatus = cell.enum('plan_item_status', PLAN_ITEM_STATUSES);
export const planItemSource = cell.enum('plan_item_source', ['route', 'adhoc']);
export const planStatus = cell.enum('plan_status', PLAN_STATUSES);

const at = (name: string) => timestamp(name, { withTimezone: true });

export const routes = cell
  .table(
    'routes',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      name: text('name').notNull(),
      recurrence: jsonb('recurrence').$type<RouteRecurrence>().notNull(),
      active: boolean('active').notNull().default(true),
      createdAt: at('created_at').notNull().defaultNow(),
      createdBy: uuid('created_by'),
      updatedAt: at('updated_at').notNull().defaultNow(),
      updatedBy: uuid('updated_by'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('routes_tenant_user').on(table.tenantId, table.userId),
      foreignKey({
        name: 'routes_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** The accounts on a route, in the order they are visited. */
export const routeAccounts = cell
  .table(
    'route_accounts',
    {
      tenantId: uuid('tenant_id').notNull(),
      routeId: uuid('route_id').notNull(),
      accountId: uuid('account_id').notNull(),
      seq: integer('seq').notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.routeId, table.accountId] }),
      index('route_accounts_tenant_account').on(table.tenantId, table.accountId),
      foreignKey({
        name: 'route_accounts_route_fk',
        columns: [table.tenantId, table.routeId],
        foreignColumns: [routes.tenantId, routes.id],
      }),
      foreignKey({
        name: 'route_accounts_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** A dated visit planned for a person at an account (M8). */
export const planItems = cell
  .table(
    'plan_items',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      accountId: uuid('account_id').notNull(),
      date: date('date').notNull(),
      purpose: text('purpose'),
      note: text('note'),
      status: planItemStatus('status').notNull().default('planned'),
      source: planItemSource('source').notNull(),
      routeId: uuid('route_id'),
      /** The visit started from it (BR-35). */
      visitId: uuid('visit_id'),
      createdAt: at('created_at').notNull().defaultNow(),
      createdBy: uuid('created_by'),
      updatedAt: at('updated_at').notNull().defaultNow(),
      rowVersion: rowVersionColumn(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('plan_items_tenant_user_date').on(table.tenantId, table.userId, table.date),
      index('plan_items_tenant_visit').on(table.tenantId, table.visitId),
      index('plan_items_tenant_planned_date')
        .on(table.tenantId, table.date)
        .where(sql`${table.status} = 'planned'`),
      index('plan_items_tenant_row_version').on(table.tenantId, table.rowVersion, table.id),
      // Generating a month twice makes nothing twice.
      uniqueIndex('plan_items_one_per_route_day')
        .on(table.tenantId, table.routeId, table.accountId, table.date)
        .where(sql`${table.routeId} is not null`),
      foreignKey({
        name: 'plan_items_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'plan_items_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      foreignKey({
        name: 'plan_items_route_fk',
        columns: [table.tenantId, table.routeId],
        foreignColumns: [routes.tenantId, routes.id],
      }),
      foreignKey({
        name: 'plan_items_visit_fk',
        columns: [table.tenantId, table.visitId],
        foreignColumns: [visits.tenantId, visits.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** A person's month of plan items, where the tenant has its plans approved (M8). */
export const planMonths = cell
  .table(
    'plan_months',
    {
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      period: text('period').notNull(),
      status: planStatus('status').notNull().default('draft'),
      /** The request the approval is about; a new one each time the month is submitted. */
      requestId: uuid('request_id'),
      approvalId: uuid('approval_id'),
      updatedAt: at('updated_at').notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.userId, table.period] }),
      uniqueIndex('plan_months_tenant_request').on(table.tenantId, table.requestId),
      foreignKey({
        name: 'plan_months_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
