import type { TenantSettings, TermValue } from '@kshetra/shared';
import { bigint, jsonb, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cell, isolation } from './common';

/**
 * A tenant's settings and words (spec 5.1, 5.2, 10.3), owned by the tenant-config module. Every
 * change moves `config_version` on, so apps know to fetch the config bundle again (spec 11.3).
 */
export const tenantSettings = cell
  .table(
    'tenant_settings',
    {
      tenantId: uuid('tenant_id').primaryKey(),
      // Only what the tenant changed; the defaults live in code (`withDefaults`).
      settings: jsonb('settings').$type<Partial<TenantSettings>>().notNull().default({}),
      configVersion: bigint('config_version', { mode: 'number' }).notNull().default(1),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      updatedBy: uuid('updated_by'),
    },
    () => [isolation()],
  )
  .enableRLS();

/** The tenant's own word for a term in one language: a noun's two forms, or a label. */
export const terminologyOverrides = cell
  .table(
    'terminology_overrides',
    {
      tenantId: uuid('tenant_id').notNull(),
      key: text('key').notNull(),
      locale: text('locale').notNull(),
      value: jsonb('value').$type<TermValue>().notNull(),
    },
    (table) => [primaryKey({ columns: [table.tenantId, table.key, table.locale] }), isolation()],
  )
  .enableRLS();
