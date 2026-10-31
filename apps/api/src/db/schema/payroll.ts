import { sql } from 'drizzle-orm';
import { check, foreignKey, numeric, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
