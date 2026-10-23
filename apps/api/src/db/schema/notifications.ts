import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
} from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cell, isolation } from './common';
import { devices, users } from './iam';

const at = (name: string) => timestamp(name, { withTimezone: true });

export const notificationEvent = cell.enum('notification_event', NOTIFICATION_EVENTS);
export const notificationCategory = cell.enum('notification_category', NOTIFICATION_CATEGORIES);
export const notificationChannel = cell.enum('notification_channel', NOTIFICATION_CHANNELS);
export const deliveryStatus = cell.enum('delivery_status', [
  'queued',
  'held',
  'sent',
  'failed',
  'skipped',
]);

/**
 * One notification to one person (M16): the in-app inbox entry, with the values its text is
 * rendered from. `dedupe_key` makes an event that arrives twice notify once. Unpartitioned at
 * launch, like submissions (decision D58).
 */
export const notifications = cell
  .table(
    'notifications',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      event: notificationEvent('event').notNull(),
      category: notificationCategory('category').notNull(),
      values: jsonb('values').$type<Record<string, string | number>>().notNull(),
      link: text('link'),
      dedupeKey: text('dedupe_key').notNull(),
      inbox: boolean('inbox').notNull().default(true),
      readAt: at('read_at'),
      createdAt: at('created_at').notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('notifications_tenant_user_dedupe').on(
        table.tenantId,
        table.userId,
        table.dedupeKey,
      ),
      index('notifications_tenant_user_created').on(table.tenantId, table.userId, table.createdAt),
      index('notifications_tenant_user_unread')
        .on(table.tenantId, table.userId)
        .where(sql`${table.readAt} is null and ${table.inbox}`),
      foreignKey({
        name: 'notifications_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Every attempt to deliver a notification outside the app (M16): its channel, status, the
 * provider's message ID, the error and the cost units.
 */
export const notificationDeliveries = cell
  .table(
    'notification_deliveries',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      notificationId: uuid('notification_id').notNull(),
      channel: notificationChannel('channel').notNull(),
      status: deliveryStatus('status').notNull(),
      /** Where it went: a push token, a number or an address, masked. */
      address: text('address'),
      providerRef: text('provider_ref'),
      error: text('error'),
      costUnits: integer('cost_units').notNull().default(0),
      attempts: integer('attempts').notNull().default(0),
      /** A held delivery waits until quiet hours end. */
      notBefore: at('not_before'),
      createdAt: at('created_at').notNull().defaultNow(),
      sentAt: at('sent_at'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('notification_deliveries_tenant_notification').on(table.tenantId, table.notificationId),
      foreignKey({
        name: 'notification_deliveries_notification_fk',
        columns: [table.tenantId, table.notificationId],
        foreignColumns: [notifications.tenantId, notifications.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** The categories a person muted (M16). */
export const notificationPrefs = cell
  .table(
    'notification_prefs',
    {
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      category: notificationCategory('category').notNull(),
      muted: boolean('muted').notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.userId, table.category] }),
      foreignKey({
        name: 'notification_prefs_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** Each phone's push address, and the language it reads, for push (M16). */
export const pushTokens = cell
  .table(
    'push_tokens',
    {
      tenantId: uuid('tenant_id').notNull(),
      deviceId: uuid('device_id').notNull(),
      userId: uuid('user_id').notNull(),
      token: text('token').notNull(),
      locale: text('locale').notNull(),
      updatedAt: at('updated_at').notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.deviceId] }),
      index('push_tokens_tenant_user').on(table.tenantId, table.userId),
      foreignKey({
        name: 'push_tokens_device_fk',
        columns: [table.tenantId, table.deviceId],
        foreignColumns: [devices.tenantId, devices.id],
      }),
      foreignKey({
        name: 'push_tokens_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
