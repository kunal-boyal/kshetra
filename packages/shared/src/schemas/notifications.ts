import { z } from 'zod';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_EVENTS } from '../notifications';
import { LOCALES } from './config';

/** The in-app inbox and notification preferences (M16, spec 11.2, decision D58). */

export const NotificationCategory = z.enum(NOTIFICATION_CATEGORIES);
export const NotificationEvent = z.enum(NOTIFICATION_EVENTS);

/**
 * One entry in the person's inbox. The reader's app renders it from `notify.<event>` with
 * `values`, in the reader's language; `link` is where it leads, as a path.
 */
export const NotificationResult = z
  .object({
    id: z.uuid(),
    event: NotificationEvent,
    category: NotificationCategory,
    values: z.record(z.string(), z.union([z.string(), z.number()])),
    link: z.string().nullable(),
    readAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'NotificationResult' });

export const NotificationListQuery = z.strictObject({
  unread: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
});

export const NotificationListResult = z.object({
  items: z.array(NotificationResult),
  nextCursor: z.string().nullable(),
  /** How many are unread, across every page. */
  unread: z.int().min(0),
});

/** Marks some entries read, or all of them. */
export const MarkNotificationsReadBody = z.union([
  z.strictObject({ ids: z.array(z.uuid()).min(1).max(200) }),
  z.strictObject({ all: z.literal(true) }),
]);

export const MarkNotificationsReadResult = z.object({ unread: z.int().min(0) });

export const NotificationPrefsResult = z
  .object({
    categories: z.array(
      z.object({ category: NotificationCategory, muted: z.boolean(), mutable: z.boolean() }),
    ),
  })
  .meta({ id: 'NotificationPrefsResult' });

/** The categories the person mutes; approvals and tracking can't be. */
export const PutNotificationPrefsBody = z.strictObject({
  muted: z.array(NotificationCategory).max(NOTIFICATION_CATEGORIES.length),
});

/** The phone's push address, in the language it reads (M16). */
export const PutPushTokenBody = z.strictObject({
  token: z
    .string()
    .trim()
    .min(10)
    .max(300)
    .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, 'An Expo push token'),
  locale: z.enum(LOCALES),
});

export type NotificationResult = z.output<typeof NotificationResult>;
export type NotificationListQuery = z.output<typeof NotificationListQuery>;
export type NotificationListResult = z.output<typeof NotificationListResult>;
export type MarkNotificationsReadBody = z.output<typeof MarkNotificationsReadBody>;
export type NotificationPrefsResult = z.output<typeof NotificationPrefsResult>;
export type PutNotificationPrefsBody = z.output<typeof PutNotificationPrefsBody>;
export type PutPushTokenBody = z.output<typeof PutPushTokenBody>;
