import { Body, Controller, Get, Headers, HttpCode, Post, Put, Query } from '@nestjs/common';
import {
  MarkNotificationsReadBody,
  MarkNotificationsReadResult,
  NotificationListQuery,
  NotificationListResult,
  NotificationPrefsResult,
  PutNotificationPrefsBody,
  PutPushTokenBody,
} from '@thelamp/shared';
import { type Access, CurrentAccess, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { NotificationsService } from './notifications.service';

/** The person's own notifications (M16): the inbox, what they mute, and their phone's push address. */
@Controller('v1')
export class NotificationsController {
  constructor(
    private readonly database: Database,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('notifications')
  @Contract({
    tag: 'Notifications',
    summary: "The caller's inbox, newest first, with how many are unread",
    query: NotificationListQuery,
    response: NotificationListResult,
  })
  @SignedIn()
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = NotificationListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.notifications.list(tx, access, input),
    );
  }

  @Post('notifications/read')
  @HttpCode(200)
  @Contract({
    tag: 'Notifications',
    summary: 'Marks some of the caller’s notifications read, or all',
    body: MarkNotificationsReadBody,
    response: MarkNotificationsReadResult,
  })
  @SignedIn()
  read(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = MarkNotificationsReadBody.parse(body);
    const idempotencyKey = requireIdempotencyKey(key);
    return this.database
      .forTenant(access.tenantId, (tx) =>
        idempotent(
          tx,
          access.tenantId,
          idempotencyKey,
          { route: 'POST /v1/notifications/read', by: access.userId, input },
          async () => ({ status: 200, body: await this.notifications.markRead(tx, access, input) }),
        ),
      )
      .then((result) => result.body);
  }

  @Get('notification-prefs')
  @Contract({
    tag: 'Notifications',
    summary: 'What the caller hears about, and what they may mute',
    response: NotificationPrefsResult,
  })
  @SignedIn()
  prefs(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, (tx) => this.notifications.prefs(tx, access));
  }

  @Put('notification-prefs')
  @Contract({
    tag: 'Notifications',
    summary: 'Replaces the categories the caller mutes; approvals and tracking can’t be',
    body: PutNotificationPrefsBody,
    response: NotificationPrefsResult,
  })
  @SignedIn()
  putPrefs(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = PutNotificationPrefsBody.parse(body);
    const idempotencyKey = requireIdempotencyKey(key);
    return this.database
      .forTenant(access.tenantId, (tx) =>
        idempotent(
          tx,
          access.tenantId,
          idempotencyKey,
          { route: 'PUT /v1/notification-prefs', by: access.userId, input },
          async () => ({ status: 200, body: await this.notifications.putPrefs(tx, access, input) }),
        ),
      )
      .then((result) => result.body);
  }

  @Put('push-tokens')
  @HttpCode(204)
  @Contract({
    tag: 'Notifications',
    summary: "Keeps the calling phone's push address and the language it reads",
    body: PutPushTokenBody,
  })
  @SignedIn()
  async pushToken(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = PutPushTokenBody.parse(body);
    requireIdempotencyKey(key);
    await this.database.forTenant(access.tenantId, (tx) =>
      this.notifications.putPushToken(tx, access, input),
    );
  }
}
