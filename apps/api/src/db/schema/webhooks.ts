import {
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { cell, changeColumns, isolation } from './common';

/**
 * A tenant's webhook subscriptions (spec 10.3, module M20, decision D94): where to post, which
 * events, and the signing secret, sealed under `COLUMN_KEY` naming its column and row. Paused,
 * nothing is sent; nothing is ever deleted.
 */
export const webhookSubscriptions = cell
  .table(
    'webhook_subscriptions',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').notNull(),
      url: text('url').notNull(),
      events: text('events').array().notNull(),
      description: text('description'),
      secretSealed: text('secret_sealed').notNull(),
      status: text('status').notNull().default('active'),
      ...changeColumns(),
    },
    (table) => [primaryKey({ columns: [table.tenantId, table.id] }), isolation()],
  )
  .enableRLS();

/**
 * One event for one subscription (decision D94): its body as signed, and where it stands. One a
 * subscription and event, so an event the outbox delivers twice is sent once. Tries are logged in
 * `webhook_deliveries`.
 */
export const webhookMessages = cell
  .table(
    'webhook_messages',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').notNull(),
      subscriptionId: uuid('subscription_id').notNull(),
      /** The outbox event's ID; null for a test. */
      eventId: uuid('event_id'),
      event: text('event').notNull(),
      body: jsonb('body').$type<Record<string, unknown>>().notNull(),
      status: text('status').notNull().default('pending'),
      attempts: integer('attempts').notNull().default(0),
      firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }),
      nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      unique('webhook_messages_event').on(table.tenantId, table.subscriptionId, table.eventId),
      index('webhook_messages_tenant_created').on(table.tenantId, table.createdAt),
      isolation(),
    ],
  )
  .enableRLS();
