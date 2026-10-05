import { jsonb, pgPolicy, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cell, cellApp, tenantIsolation } from './common';

/** What an idempotent request stored, replayed as is when the same key comes back (BR-46). */
export interface StoredResponse {
  status: number;
  body: unknown;
}

export const idempotencyKeys = cell
  .table(
    'idempotency_keys',
    {
      tenantId: uuid('tenant_id').notNull(),
      key: text('key').notNull(),
      requestHash: text('request_hash').notNull(),
      response: jsonb('response').$type<StoredResponse>(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.key] }),
      pgPolicy('tenant_isolation', {
        as: 'permissive',
        for: 'all',
        to: cellApp,
        using: tenantIsolation,
        withCheck: tenantIsolation,
      }),
    ],
  )
  .enableRLS();
