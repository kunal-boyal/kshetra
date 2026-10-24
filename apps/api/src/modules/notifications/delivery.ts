import { Inject, Injectable, Logger } from '@nestjs/common';
import { notificationMessage, resolveTerminology, translate } from '@thelamp/i18n';
import {
  type Locale,
  maskPhone,
  NOTIFICATION_KINDS,
  type NotificationEventKey,
  smsSegments,
  WHATSAPP_CONSENT_VERSION,
} from '@thelamp/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Config } from '../../config';
import {
  notificationDeliveries,
  notifications,
  pushTokens,
  whatsappConsents,
} from '../../db/schema/notifications';
import { Database, type TenantTx } from '../../platform/database';
import { CONFIG } from '../../platform/tokens';
import { People } from '../iam/people';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { NotificationsService } from './notifications.service';
import {
  EmailSender,
  maskEmail,
  maskToken,
  PushSender,
  type SendResult,
  SmsSender,
  WhatsAppSender,
} from './senders';

type Channel = 'push' | 'whatsapp' | 'sms' | 'email';

interface Outcome {
  status: 'sent' | 'failed' | 'skipped';
  address: string | null;
  result: SendResult | null;
  /** Push tokens the provider no longer knows, to forget. */
  deadTokens: string[];
  /** Why a skipped channel couldn't reach the person. */
  reason?: string;
}

/** A delivery that failed in a way a retry may fix: the job runs again. */
export class TransientDeliveryError extends Error {}

/**
 * Delivers one notification by one channel (M16, decision D58): it holds the delivery's row while
 * it reads what to send, sends, and records the outcome, so it never goes twice. Text is rendered in the
 * reader's language: a phone's own for push, the tenant's first language for SMS and email. When
 * a channel can't reach the person (no phone registered, no number, refused), the next channel of
 * the event is tried. A delivery already sent is never sent again.
 */
@Injectable()
export class NotificationDelivery {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly database: Database,
    private readonly config: TenantConfigService,
    private readonly people: People,
    private readonly service: NotificationsService,
    private readonly push: PushSender,
    private readonly sms: SmsSender,
    private readonly email: EmailSender,
    private readonly whatsapp: WhatsAppSender,
    @Inject(CONFIG) private readonly cell: Config,
  ) {}

  private async text(
    tx: TenantTx,
    tenantId: string,
    event: NotificationEventKey,
    values: Record<string, string | number>,
    locale: Locale,
  ) {
    const terms = resolveTerminology(await this.config.terminology(tx, tenantId), locale);
    const message = notificationMessage(event, values, locale);
    return {
      title: translate(message.title, { locale, params: message.params, terms }),
      body: translate(message.body, { locale, params: message.params, terms }),
    };
  }

  async deliver(tenantId: string, deliveryId: string): Promise<void> {
    // One transaction holds the delivery's row from reading to recording, so a job run twice at
    // once (delivery is at least once) sends once: the second finds the row taken, or finished.
    const retry = await this.database.forTenant(tenantId, async (tx) => {
      const [delivery] = await tx
        .select()
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.tenantId, tenantId),
            eq(notificationDeliveries.id, deliveryId),
          ),
        )
        .for('update', { skipLocked: true });
      if (!delivery || !['queued', 'held'].includes(delivery.status)) return null;
      const [notification] = await tx
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.tenantId, tenantId), eq(notifications.id, delivery.notificationId)),
        );
      if (!notification) return null;
      const channel = delivery.channel as Channel;
      const outcome = await this.send(tx, tenantId, channel, notification);
      if ('transient' in outcome) {
        await tx
          .update(notificationDeliveries)
          .set({ attempts: sql`${notificationDeliveries.attempts} + 1`, error: outcome.transient })
          .where(
            and(
              eq(notificationDeliveries.tenantId, tenantId),
              eq(notificationDeliveries.id, deliveryId),
            ),
          );
        return outcome.transient;
      }
      await tx
        .update(notificationDeliveries)
        .set({
          status: outcome.status,
          address: outcome.address,
          providerRef: outcome.result?.providerRef ?? null,
          error:
            outcome.status === 'skipped'
              ? (outcome.reason ??
                (channel === 'push'
                  ? 'No phone registered for push'
                  : `No ${channel === 'email' ? 'email address' : 'number'} on record`))
              : (outcome.result?.error ?? null),
          costUnits: outcome.result?.costUnits ?? 0,
          attempts: delivery.attempts + 1,
          sentAt: outcome.status === 'sent' ? new Date() : null,
        })
        .where(
          and(
            eq(notificationDeliveries.tenantId, tenantId),
            eq(notificationDeliveries.id, deliveryId),
          ),
        );
      for (const token of outcome.deadTokens) {
        await tx
          .delete(pushTokens)
          .where(and(eq(pushTokens.tenantId, tenantId), eq(pushTokens.token, token)));
      }
      if (outcome.status !== 'sent') {
        // The next channel the event lists, if any (M16: push, then WhatsApp, then SMS).
        const kind = NOTIFICATION_KINDS[notification.event];
        const chain = kind.external as readonly Channel[];
        const next = chain[chain.indexOf(channel) + 1];
        if (next)
          await this.service.queueDelivery(tx, tenantId, notification.id, next, kind.urgent);
      }
      if (outcome.status === 'failed') {
        this.logger.warn(
          `${channel} delivery ${deliveryId} failed: ${outcome.result?.error ?? '?'}`,
        );
      }
      return null;
    });
    if (retry) throw new TransientDeliveryError(retry);
  }

  /** Renders and sends by one channel; a transient failure is for the queue to retry. */
  private async send(
    tx: TenantTx,
    tenantId: string,
    channel: Channel,
    notification: typeof notifications.$inferSelect,
  ): Promise<Outcome | { transient: string }> {
    const skipped: Outcome = { status: 'skipped', address: null, result: null, deadTokens: [] };
    if (channel === 'push') {
      const tokens = await tx
        .select({ token: pushTokens.token, locale: pushTokens.locale })
        .from(pushTokens)
        .where(and(eq(pushTokens.tenantId, tenantId), eq(pushTokens.userId, notification.userId)));
      if (tokens.length === 0) return skipped;
      const messages = [];
      for (const token of tokens) {
        const locale = (token.locale === 'hi' ? 'hi' : 'en') as Locale;
        messages.push({
          token: token.token,
          ...(await this.text(tx, tenantId, notification.event, notification.values, locale)),
          link: notification.link,
        });
      }
      const results = await Promise.all(messages.map((message) => this.push.send(message)));
      const sent = results.find((result) => result.ok);
      const failure = results.find((result) => !result.ok && !result.permanent);
      if (!sent && failure) return { transient: failure.error ?? 'Push failed' };
      return {
        status: sent ? 'sent' : 'failed',
        address: messages.map((message) => maskToken(message.token)).join(', '),
        result: sent ?? results[0] ?? null,
        deadTokens: messages
          .filter((_, index) => results[index]!.permanent)
          .map((message) => message.token),
      };
    }
    if (channel === 'whatsapp') return this.sendWhatsApp(tx, tenantId, notification);
    const settings = await this.config.settings(tx, tenantId);
    const locale = (settings.languages[0] ?? 'en') as Locale;
    const contact = (await this.people.contacts(tx, tenantId, [notification.userId])).get(
      notification.userId,
    );
    const address = channel === 'sms' ? (contact?.phone ?? null) : (contact?.email ?? null);
    if (!address) return skipped;
    const text = await this.text(tx, tenantId, notification.event, notification.values, locale);
    const result =
      channel === 'sms'
        ? await this.sms.send({
            phone: address,
            text: `${text.title}: ${text.body}`,
            segments: smsSegments(`${text.title}: ${text.body}`),
            event: notification.event,
            locale,
            values: Object.fromEntries(
              Object.entries(notification.values).map(([name, value]) => [name, String(value)]),
            ),
          })
        : await this.email.send({ to: address, subject: text.title, text: text.body });
    if (!result.ok && !result.permanent) return { transient: result.error ?? 'Delivery failed' };
    return {
      status: result.ok ? 'sent' : 'failed',
      address: channel === 'sms' ? maskPhone(address) : maskEmail(address),
      result,
      deadTokens: [],
    };
  }

  /**
   * WhatsApp (decision D85): only when this cell sends it, to people who agreed to the current
   * text (spec 13.4), in the approved template for the event and the tenant's first language
   * (spec 5.12). Without a template the delivery fails, and the next channel is tried.
   */
  private async sendWhatsApp(
    tx: TenantTx,
    tenantId: string,
    notification: typeof notifications.$inferSelect,
  ): Promise<Outcome | { transient: string }> {
    const skipped = (reason: string): Outcome => ({
      status: 'skipped',
      address: null,
      result: null,
      deadTokens: [],
      reason,
    });
    if (!this.whatsapp.enabled) return skipped('WhatsApp is off');
    const [consent] = await tx
      .select()
      .from(whatsappConsents)
      .where(
        and(
          eq(whatsappConsents.tenantId, tenantId),
          eq(whatsappConsents.userId, notification.userId),
        ),
      );
    if (!consent?.optedIn || consent.version !== WHATSAPP_CONSENT_VERSION) {
      return skipped('No WhatsApp opt-in');
    }
    const phone = (await this.people.contacts(tx, tenantId, [notification.userId])).get(
      notification.userId,
    )?.phone;
    if (!phone) return skipped('No number on record');
    const settings = await this.config.settings(tx, tenantId);
    const locale = (settings.languages[0] ?? 'en') as Locale;
    const templates = this.cell.WHATSAPP_TEMPLATES[notification.event];
    const template = templates?.[locale] ?? templates?.en;
    const failed = (error: string): Outcome => ({
      status: 'failed',
      address: maskPhone(phone),
      result: { ok: false, permanent: true, error },
      deadTokens: [],
    });
    if (!template) return failed(`No approved WhatsApp template for ${notification.event}`);
    const text = await this.text(tx, tenantId, notification.event, notification.values, locale);
    const result = await this.whatsapp.send({
      phone,
      template,
      locale,
      values: Object.fromEntries(
        Object.entries(notification.values).map(([name, value]) => [name, String(value)]),
      ),
      text: `${text.title}: ${text.body}`,
    });
    if (!result.ok && !result.permanent) return { transient: result.error ?? 'WhatsApp failed' };
    return {
      status: result.ok ? 'sent' : 'failed',
      address: maskPhone(phone),
      result,
      deadTokens: [],
    };
  }
}
