import type { MetricDefinition } from '@kshetra/metrics';
import { boolean, integer, jsonb, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cell, isolation } from './common';

/**
 * The tenant's metric definitions (spec 5.7, 10.3), owned by the metrics module: each metric's
 * whole definition, by its key, as the tenant's template gave it. The metric engine (step 12)
 * computes from them; targets and account plans refer to them by key.
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
