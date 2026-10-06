import { sql } from 'drizzle-orm';
import { index, integer, jsonb, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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

/**
 * Domain events waiting for delivery (spec 12.4). Each is written in the same transaction as the
 * change it reports, delivered right after commit, and retried with backoff by the relay until
 * every consumer has taken it. Delivered rows are purged after 3 days (spec 10.4).
 */
export const outboxEvents = cell
  .table(
    'outbox_events',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      type: text('type').notNull(),
      aggregateId: uuid('aggregate_id').notNull(),
      payload: jsonb('payload').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      attempts: integer('attempts').notNull().default(0),
      nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
      lastError: text('last_error'),
      dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      // The relay looks across tenants for what is due, so this one index is not led by tenant.
      index('outbox_events_due')
        .on(table.nextAttemptAt)
        .where(sql`${table.dispatchedAt} is null`),
      isolation(),
    ],
  )
  .enableRLS();
