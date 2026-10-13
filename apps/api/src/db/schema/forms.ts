import type { FormDefinition } from '@kshetra/forms';
import {
  boolean,
  foreignKey,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cell, changeColumns, isolation } from './common';

/**
 * Forms (spec 5.6, 10.3), owned by the forms module. Each publish adds a version; submissions
 * keep the version they were captured with, so history renders as it was entered.
 */
export const forms = cell
  .table(
    'forms',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      key: text('key').notNull(),
      currentVersion: integer('current_version').notNull(),
      active: boolean('active').notNull().default(true),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('forms_tenant_key').on(table.tenantId, table.key),
      isolation(),
    ],
  )
  .enableRLS();

export const formVersions = cell
  .table(
    'form_versions',
    {
      tenantId: uuid('tenant_id').notNull(),
      formId: uuid('form_id').notNull(),
      version: integer('version').notNull(),
      definition: jsonb('definition').$type<FormDefinition>().notNull(),
      publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
      publishedBy: uuid('published_by'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.formId, table.version] }),
      foreignKey({
        name: 'form_versions_form_fk',
        columns: [table.tenantId, table.formId],
        foreignColumns: [forms.tenantId, forms.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
