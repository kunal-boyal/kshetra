import { integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cell } from './schema/common';

/**
 * The webhook delivery log (spec 10.3, 10.4, decision D94): one row a try, append-only. Migration
 * 0064 creates it partitioned by month, so retention drops whole months; this definition stays
 * outside the schema files drizzle-kit reads, as the audit log's does.
 */
export const webhookDeliveries = cell.table('webhook_deliveries', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  subscriptionId: uuid('subscription_id').notNull(),
  messageId: uuid('message_id').notNull(),
  attempt: integer('attempt').notNull(),
  status: text('status').notNull(),
  responseCode: integer('response_code'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
