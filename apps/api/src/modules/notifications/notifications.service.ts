import { Injectable } from '@nestjs/common';
import {
  AppError,
  inQuietHours,
  minutesUntilQuietEnds,
  mutable,
  newId,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_KINDS,
  type MarkNotificationsReadBody,
  type NotificationCategoryKey,
  type NotificationEventKey,
  type NotificationListQuery,
  type NotificationListResult,
  type NotificationPrefsResult,
  type PutNotificationPrefsBody,
  type PutPushTokenBody,
  timeIn,
} from '@kshetra/shared';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
  notificationDeliveries,
  notificationPrefs,
  notifications,
  pushTokens,
} from '../../db/schema/notifications';
import type { Access } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { Queues } from '../../platform/queues';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

export interface Notify {
  userId: string;
  event: NotificationEventKey;
  values: Record<string, string | number>;
  link?: string | null;
  /** Names the occurrence, so the same event arriving twice notifies once. */
  dedupeKey: string;
}

/** The job that delivers one notification by one channel. */
export const DELIVER = 'notifications.deliver';

/**
 * Notifications (M16, decision D58): the in-app entry and its first delivery outside the app,
 * written in the transaction of the change that caused them; the deliveries run once it commits.
 * A muted category keeps its inbox entry and sends nothing else. Quiet hours hold non-urgent
 * push and SMS until they end.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly database: Database,
    private readonly queues: Queues,
    private readonly config: TenantConfigService,
  ) {}

  /** The categories a person muted. */
  async muted(
    tx: TenantTx,
    tenantId: string,
    userId: string,
  ): Promise<Set<NotificationCategoryKey>> {
    const rows = await tx
      .select({ category: notificationPrefs.category })
      .from(notificationPrefs)
      .where(
        and(
          eq(notificationPrefs.tenantId, tenantId),
          eq(notificationPrefs.userId, userId),
          eq(notificationPrefs.muted, true),
        ),
      );
    return new Set(rows.map((row) => row.category));
  }

  /** Notifies one person; returns the notification's ID, or null when it was sent already. */
  async notify(tx: TenantTx, tenantId: string, input: Notify): Promise<string | null> {
    const kind = NOTIFICATION_KINDS[input.event];
    const id = newId();
    const [made] = await tx
      .insert(notifications)
      .values({
        id,
        tenantId,
        userId: input.userId,
        event: input.event,
        category: kind.category,
        values: input.values,
        link: input.link ?? null,
        dedupeKey: input.dedupeKey,
        inbox: kind.inbox,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!made) return null;
    const muted =
      mutable(kind.category) && (await this.muted(tx, tenantId, input.userId)).has(kind.category);
    const [first] = kind.external;
    if (!first || muted) return id;
    await this.queueDelivery(tx, tenantId, id, first, kind.urgent);
    return id;
  }

  /**
   * Queues a delivery by one channel once the transaction commits; held until quiet hours end
   * when the notification isn't urgent and the channel interrupts (push, SMS).
   */
  async queueDelivery(
    tx: TenantTx,
    tenantId: string,
    notificationId: string,
    channel: 'push' | 'sms' | 'email',
    urgent: boolean,
  ): Promise<void> {
    const settings = await this.config.settings(tx, tenantId);
    const now = timeIn(settings.timezone);
    const quiet =
      !urgent &&
      channel !== 'email' &&
      inQuietHours(now, settings.quietHoursStart, settings.quietHoursEnd);
    const delayMs = quiet
      ? minutesUntilQuietEnds(now, settings.quietHoursStart, settings.quietHoursEnd) * 60_000
      : 0;
    const deliveryId = newId();
    await tx.insert(notificationDeliveries).values({
      id: deliveryId,
      tenantId,
      notificationId,
      channel,
      status: quiet ? 'held' : 'queued',
      notBefore: quiet ? new Date(Date.now() + delayMs) : null,
    });
    this.database.afterCommit(tx, () =>
      this.queues.add(
        'notifications',
        DELIVER,
        { tenantId, deliveryId },
        { jobId: deliveryId, ...(delayMs > 0 ? { delay: delayMs } : {}) },
      ),
    );
  }

  /** The person's inbox, newest first, a page at a time, with how many are unread. */
  async list(
    tx: TenantTx,
    access: Access,
    query: NotificationListQuery,
  ): Promise<NotificationListResult> {
    const mine = and(
      eq(notifications.tenantId, access.tenantId),
      eq(notifications.userId, access.userId),
      eq(notifications.inbox, true),
    );
    const [cursorAt, cursorId] = query.cursor ? query.cursor.split('|') : [];
    const after =
      cursorAt && cursorId && !Number.isNaN(Date.parse(cursorAt))
        ? or(
            lt(notifications.createdAt, new Date(cursorAt)),
            and(eq(notifications.createdAt, new Date(cursorAt)), lt(notifications.id, cursorId)),
          )
        : undefined;
    const rows = await tx
      .select()
      .from(notifications)
      .where(and(mine, query.unread === 'true' ? isNull(notifications.readAt) : undefined, after))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        event: row.event,
        category: row.category,
        values: row.values,
        link: row.link,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > query.limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
      unread: await this.unread(tx, access),
    };
  }

  private async unread(tx: TenantTx, access: Access): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, access.tenantId),
          eq(notifications.userId, access.userId),
          eq(notifications.inbox, true),
          isNull(notifications.readAt),
        ),
      );
    return row?.count ?? 0;
  }

  /** Marks some of the person's notifications read, or all; another's IDs change nothing. */
  async markRead(tx: TenantTx, access: Access, body: MarkNotificationsReadBody) {
    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.tenantId, access.tenantId),
          eq(notifications.userId, access.userId),
          isNull(notifications.readAt),
          'ids' in body ? inArray(notifications.id, body.ids) : undefined,
        ),
      );
    return { unread: await this.unread(tx, access) };
  }

  async prefs(tx: TenantTx, access: Access): Promise<NotificationPrefsResult> {
    const muted = await this.muted(tx, access.tenantId, access.userId);
    return {
      categories: NOTIFICATION_CATEGORIES.map((category) => ({
        category,
        muted: muted.has(category),
        mutable: mutable(category),
      })),
    };
  }

  /** Replaces what the person mutes. Approvals and tracking can't be muted (M16). */
  async putPrefs(
    tx: TenantTx,
    access: Access,
    body: PutNotificationPrefsBody,
  ): Promise<NotificationPrefsResult> {
    const fixed = body.muted.filter((category) => !mutable(category));
    if (fixed.length > 0) {
      throw new AppError(
        'VALIDATION',
        'Some notifications can’t be muted.',
        fixed.map((category) => ({
          path: 'muted',
          issue: `${category} notifications can’t be muted`,
        })),
      );
    }
    await tx
      .delete(notificationPrefs)
      .where(
        and(
          eq(notificationPrefs.tenantId, access.tenantId),
          eq(notificationPrefs.userId, access.userId),
        ),
      );
    const muted = [...new Set(body.muted)];
    if (muted.length > 0) {
      await tx.insert(notificationPrefs).values(
        muted.map((category) => ({
          tenantId: access.tenantId,
          userId: access.userId,
          category,
          muted: true,
        })),
      );
    }
    return this.prefs(tx, access);
  }

  /** Keeps the phone's push address and language; only a phone has one. */
  async putPushToken(tx: TenantTx, access: Access, body: PutPushTokenBody): Promise<void> {
    if (!access.deviceId) {
      throw new AppError('FORBIDDEN', 'Only a signed-in phone registers for push.');
    }
    // A token belongs to one phone: a token another phone held moves here.
    await tx
      .delete(pushTokens)
      .where(and(eq(pushTokens.tenantId, access.tenantId), eq(pushTokens.token, body.token)));
    await tx
      .insert(pushTokens)
      .values({
        tenantId: access.tenantId,
        deviceId: access.deviceId,
        userId: access.userId,
        token: body.token,
        locale: body.locale,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [pushTokens.tenantId, pushTokens.deviceId],
        set: {
          userId: access.userId,
          token: body.token,
          locale: body.locale,
          updatedAt: new Date(),
        },
      });
  }
}
