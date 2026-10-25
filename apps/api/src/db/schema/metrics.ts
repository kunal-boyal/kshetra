import type { MetricDefinition, ScoreDefinition } from '@thelamp/metrics';
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
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { cell, isolation } from './common';
import { users } from './iam';

/**
 * The tenant's metric definitions (spec 5.7, 10.3), owned by the metrics module: each metric's
 * whole definition, by its key, as the tenant's template gave it. The metric engine computes from
 * them; targets and account plans refer to them by key.
 */
export const metricDefinitions = cell
  .table(
    'metric_definitions',
    {
      tenantId: uuid('tenant_id').notNull(),
      key: text('key').notNull(),
      version: integer('version').notNull().default(1),
      definition: jsonb('definition').$type<MetricDefinition>().notNull(),
      targetable: boolean('targetable').notNull(),
      active: boolean('active').notNull().default(true),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [primaryKey({ columns: [table.tenantId, table.key] }), isolation()],
  )
  .enableRLS();

/** The tenant's score definition (spec 5.8, BR-06), from its template until step 16 edits it. */
export const scoreDefinitions = cell
  .table(
    'score_definitions',
    {
      tenantId: uuid('tenant_id').notNull().primaryKey(),
      version: integer('version').notNull().default(1),
      definition: jsonb('definition').$type<ScoreDefinition>().notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    () => [isolation()],
  )
  .enableRLS();

/**
 * One metric's value for one person and day (spec 12.5), recomputed from the source records
 * whenever something on that day changes. Periods are sums of days; ratios keep their parts
 * (BR-04). Unpartitioned at launch, like submissions (decision D56).
 */
export const metricFactsDaily = cell
  .table(
    'metric_facts_daily',
    {
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      date: date('date').notNull(),
      metricKey: text('metric_key').notNull(),
      value: numeric('value', { precision: 18, scale: 3 }).notNull(),
      numerator: numeric('numerator', { precision: 18, scale: 3 }),
      denominator: numeric('denominator', { precision: 18, scale: 3 }),
      /** What pending submissions would add (BR-02). */
      pending: numeric('pending', { precision: 18, scale: 3 }),
      computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.userId, table.date, table.metricKey] }),
      index('metric_facts_daily_tenant_date').on(table.tenantId, table.date),
      foreignKey({
        name: 'metric_facts_daily_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * The accounts behind a day's distinct count (spec 12.5), so a period's distinct count is exact:
 * one row per person, day, metric and account.
 */
export const metricFactAccounts = cell
  .table(
    'metric_fact_accounts',
    {
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      date: date('date').notNull(),
      metricKey: text('metric_key').notNull(),
      accountId: uuid('account_id').notNull(),
    },
    (table) => [
      primaryKey({
        columns: [table.tenantId, table.userId, table.date, table.metricKey, table.accountId],
      }),
      index('metric_fact_accounts_tenant_metric_date').on(
        table.tenantId,
        table.metricKey,
        table.date,
      ),
      foreignKey({
        name: 'metric_fact_accounts_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'metric_fact_accounts_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** Scores and ranks as the nightly job found them, for history (spec 12.5). */
export const scoreSnapshots = cell
  .table(
    'score_snapshots',
    {
      tenantId: uuid('tenant_id').notNull(),
      period: text('period').notNull(),
      userId: uuid('user_id').notNull(),
      score: integer('score'),
      rank: integer('rank'),
      groupKey: text('group_key').notNull(),
      computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.period, table.userId] }),
      foreignKey({
        name: 'score_snapshots_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Values of external metrics (spec 5.7, B.6, decision D94), loaded by import or the bulk API from
 * systems such as an ERP: for a person, or for an account, on a day, or for a month on its last
 * day. One value per metric, subject and day; loading it again replaces it. An account's value
 * counts for the holder of its type's first slot on that day, as `credited_user_id` records.
 */
export const externalMetricValues = cell
  .table(
    'external_metric_values',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').notNull(),
      metricKey: text('metric_key').notNull(),
      userId: uuid('user_id'),
      accountId: uuid('account_id'),
      date: date('date').notNull(),
      /** Given for the whole month the date ends. */
      month: boolean('month').notNull().default(false),
      value: numeric('value', { precision: 18, scale: 3 }).notNull(),
      /** Whose figures it counts in: the person, or the account's field person that day. */
      creditedUserId: uuid('credited_user_id'),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      updatedBy: uuid('updated_by'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      unique('external_metric_values_subject')
        .on(table.tenantId, table.metricKey, table.userId, table.accountId, table.date)
        .nullsNotDistinct(),
      index('external_metric_values_credited').on(table.tenantId, table.creditedUserId, table.date),
      foreignKey({
        name: 'external_metric_values_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'external_metric_values_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      check(
        'external_metric_values_one_subject',
        sql`(${table.userId} is null) <> (${table.accountId} is null)`,
      ),
      isolation(),
    ],
  )
  .enableRLS();
