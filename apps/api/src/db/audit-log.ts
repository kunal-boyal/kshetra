import { AUDIT_ACTOR_KINDS } from '@kshetra/shared';
import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cell } from './schema/common';

/**
 * The audit log, for queries. Migration 0007 creates it partitioned by month, which drizzle-kit
 * can't express, so this definition stays outside the schema files drizzle-kit reads.
 */
export const auditActorKind = cell.enum('audit_actor_kind', AUDIT_ACTOR_KINDS);

export const auditLog = cell.table('audit_log', {
  id: uuid('id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  actorId: uuid('actor_id'),
  actorKind: auditActorKind('actor_kind').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: text('ip'),
  deviceId: uuid('device_id'),
  supportGrantId: uuid('support_grant_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
