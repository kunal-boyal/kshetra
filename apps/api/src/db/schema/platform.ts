import { jsonb, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cell, isolation } from './common';

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
    (table) => [primaryKey({ columns: [table.tenantId, table.key] }), isolation()],
  )
  .enableRLS();
