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
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cell, isolation } from './common';
import { users } from './iam';

/**
 * Payroll inputs (M14, decisions D14 and D117), owned by the payroll module: each change of a
 * person's monthly gross, in force from a month, so a month already gone keeps its gross. Gross is
 * personal data: erasure removes it, and audit entries never hold the figure.
 */
export const payrollGross = cell
  .table(
    'payroll_gross',
    {
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      /** The first month it is in force, `YYYY-MM`. */
      fromPeriod: text('from_period').notNull(),
      monthlyGross: numeric('monthly_gross', { precision: 18, scale: 2 }).notNull(),
      updatedBy: uuid('updated_by'),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.userId, table.fromPeriod] }),
      foreignKey({
        name: 'payroll_gross_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      check('payroll_gross_period', sql`${table.fromPeriod} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
      check('payroll_gross_positive', sql`${table.monthlyGross} >= 0`),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Statutory payroll (M14, BR-56 to BR-58, decision D128): each person's salary structure from a
 * month, so a month already paid keeps its structure. Pay is personal data: erasure removes the
 * structure, and audit entries never hold an amount.
 */
export const salaryStructures = cell
  .table(
    'salary_structures',
    {
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      fromPeriod: text('from_period').notNull(),
      basic: numeric('basic', { precision: 18, scale: 2 }).notNull(),
      da: numeric('da', { precision: 18, scale: 2 }).notNull(),
      hra: numeric('hra', { precision: 18, scale: 2 }).notNull(),
      conveyance: numeric('conveyance', { precision: 18, scale: 2 }).notNull(),
      special: numeric('special', { precision: 18, scale: 2 }).notNull(),
      /** Other allowances: `[{ key, amount, excluded }]`. */
      others: jsonb('others').notNull().default([]),
      updatedBy: uuid('updated_by'),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.userId, table.fromPeriod] }),
      foreignKey({
        name: 'salary_structures_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      check('salary_structures_period', sql`${table.fromPeriod} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * What a payslip needs to know of a person beyond pay (D128): where they work for professional
 * tax and the welfare fund, PF membership and its option, and the UAN and ESI number printed on
 * the payslip. The PAN is never kept; only whether the employer holds it.
 */
export const statutoryProfiles = cell
  .table(
    'statutory_profiles',
    {
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      workState: text('work_state'),
      ptWomen: boolean('pt_women').notNull().default(false),
      pfMember: boolean('pf_member').notNull().default(true),
      pfFullWage: boolean('pf_full_wage').notNull().default(false),
      uan: text('uan'),
      esiNumber: text('esi_number'),
      panOnFile: boolean('pan_on_file').notNull().default(false),
      updatedBy: uuid('updated_by'),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.userId] }),
      foreignKey({
        name: 'statutory_profiles_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** A month's pay run (D128): a draft until approved, when its payslips freeze. */
export const payRuns = cell
  .table(
    'pay_runs',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').notNull(),
      period: text('period').notNull(),
      status: text('status').notNull().default('draft'),
      rateSetId: text('rate_set_id').notNull(),
      rulesVersion: integer('rules_version').notNull(),
      version: integer('version').notNull().default(1),
      createdBy: uuid('created_by'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      approvedBy: uuid('approved_by'),
      approvedAt: timestamp('approved_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('pay_runs_tenant_period').on(table.tenantId, table.period),
      check('pay_runs_status', sql`${table.status} in ('draft', 'approved')`),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * One person's payslip in a run (D128): the structure and profile it was worked out on, the days,
 * and every figure. Written while the run is a draft; frozen once it is approved, never changed.
 * People who leave a draft's reach are marked out rather than removed.
 */
export const payslips = cell
  .table(
    'payslips',
    {
      tenantId: uuid('tenant_id').notNull(),
      payRunId: uuid('pay_run_id').notNull(),
      userId: uuid('user_id').notNull(),
      period: text('period').notNull(),
      included: boolean('included').notNull().default(true),
      structure: jsonb('structure').notNull(),
      profile: jsonb('profile').notNull(),
      paidHalves: integer('paid_halves').notNull(),
      scheduled: integer('scheduled').notNull(),
      esiCovered: boolean('esi_covered').notNull(),
      figures: jsonb('figures').notNull(),
      gross: numeric('gross', { precision: 18, scale: 2 }).notNull(),
      tds: numeric('tds', { precision: 18, scale: 2 }).notNull(),
      net: numeric('net', { precision: 18, scale: 2 }).notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.payRunId, table.userId] }),
      index('payslips_tenant_user_period').on(table.tenantId, table.userId, table.period),
      foreignKey({
        name: 'payslips_run_fk',
        columns: [table.tenantId, table.payRunId],
        foreignColumns: [payRuns.tenantId, payRuns.id],
      }),
      foreignKey({
        name: 'payslips_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** An earning or deduction for one person in a month's run, such as arrears or a correction. */
export const payAdjustments = cell
  .table(
    'pay_adjustments',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').notNull(),
      userId: uuid('user_id').notNull(),
      period: text('period').notNull(),
      kind: text('kind').notNull(),
      key: text('key').notNull(),
      amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
      note: text('note').notNull(),
      createdBy: uuid('created_by'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('pay_adjustments_tenant_period').on(table.tenantId, table.period, table.userId),
      foreignKey({
        name: 'pay_adjustments_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      check('pay_adjustments_kind', sql`${table.kind} in ('earning', 'deduction')`),
      isolation(),
    ],
  )
  .enableRLS();
