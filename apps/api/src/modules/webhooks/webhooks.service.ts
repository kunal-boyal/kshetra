import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CreateWebhookBody,
  newId,
  type UpdateWebhookBody,
  WEBHOOK_TEST_EVENT,
  type WebhookDelivery,
  type WebhookEventKey,
  type WebhookResult,
  webhookRetryDelay,
} from '@thelamp/shared';
import { and, asc, desc, eq, lt, or, sql } from 'drizzle-orm';
import { webhookMessages, webhookSubscriptions } from '../../db/schema/webhooks';
import { webhookDeliveries } from '../../db/webhook-deliveries';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import { ColumnCipher } from '../../platform/column-cipher';
import { Database, type TenantTx } from '../../platform/database';
import { Queues } from '../../platform/queues';
import { newWebhookSecret, WebhookSender } from './webhook-sender';

type Subscription = typeof webhookSubscriptions.$inferSelect;

/** The job that tries one message; its ID names the message and the try. */
export const DELIVER = 'webhooks.deliver';
const jobId = (messageId: string, attempt: number) => `wh.${messageId}.${attempt}`;

const notFound = () => new AppError('NOT_FOUND', 'This was not found.');
const invalidUrl = (issue: string) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', [{ path: 'url', issue }]);

/** Where the secret is sealed: its column and row, so it can't be moved to another. */
const sealedAt = (id: string) => `webhook_subscriptions.secret_sealed:${id}`;

/**
 * Webhooks (module M20, spec 12.4, decision D94): tenant admins subscribe their systems to domain
 * events; each event becomes one message a subscription, posted signed and tried again for a day
 * until the receiver takes it; every try is logged, and any message can be sent again.
 */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly cipher: ColumnCipher,
    private readonly sender: WebhookSender,
    private readonly queues: Queues,
  ) {}

  async list(tx: TenantTx, tenantId: string): Promise<WebhookResult[]> {
    const rows = await tx
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.tenantId, tenantId))
      .orderBy(asc(webhookSubscriptions.createdAt));
    return Promise.all(rows.map((row) => this.result(tx, row)));
  }

  /**
   * Seals every subscription's secret again under the current column key, after a rotation
   * (`pnpm reseal`, decision D101); those sealed under it already stay as they are.
   */
  async resealSecrets(tenantId: string): Promise<number> {
    return this.database.forTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ id: webhookSubscriptions.id, secretSealed: webhookSubscriptions.secretSealed })
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.tenantId, tenantId));
      let resealed = 0;
      for (const row of rows) {
        if (this.cipher.isCurrent(row.secretSealed)) continue;
        await tx
          .update(webhookSubscriptions)
          .set({ secretSealed: this.cipher.reseal(row.secretSealed, sealedAt(row.id)) })
          .where(
            and(eq(webhookSubscriptions.tenantId, tenantId), eq(webhookSubscriptions.id, row.id)),
          );
        resealed += 1;
      }
      return resealed;
    });
  }

  /** Subscribes a receiver; its signing secret comes back now and never again. */
  async create(
    tx: TenantTx,
    access: Access,
    body: CreateWebhookBody,
  ): Promise<{ webhook: WebhookResult; secret: string }> {
    const issue = await this.sender.urlIssue(body.url);
    if (issue) throw invalidUrl(issue);
    const [existing] = await tx
      .select({ id: webhookSubscriptions.id })
      .from(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.tenantId, access.tenantId),
          eq(webhookSubscriptions.id, body.id),
        ),
      );
    if (existing) {
      throw new AppError(
        'CONFLICT',
        'This webhook exists already. Rotate its secret to get a new one.',
      );
    }
    const secret = newWebhookSecret();
    const [row] = await tx
      .insert(webhookSubscriptions)
      .values({
        tenantId: access.tenantId,
        id: body.id,
        url: body.url,
        events: body.events,
        description: body.description ?? null,
        secretSealed: this.cipher.seal(secret, sealedAt(body.id)),
        createdBy: access.userId,
        updatedBy: access.userId,
      })
      .returning();
    const webhook = await this.result(tx, row!);
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'webhook.created',
      target: { type: 'webhook', id: body.id },
      after: { url: webhook.url, events: webhook.events },
    });
    return { webhook, secret };
  }

  async update(
    tx: TenantTx,
    access: Access,
    id: string,
    body: UpdateWebhookBody,
  ): Promise<WebhookResult> {
    const current = await this.locked(tx, access.tenantId, id);
    if (body.url) {
      const issue = await this.sender.urlIssue(body.url);
      if (issue) throw invalidUrl(issue);
    }
    const [row] = await tx
      .update(webhookSubscriptions)
      .set({
        ...(body.url !== undefined ? { url: body.url } : {}),
        ...(body.events !== undefined ? { events: body.events } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        updatedAt: new Date(),
        updatedBy: access.userId,
      })
      .where(
        and(eq(webhookSubscriptions.tenantId, access.tenantId), eq(webhookSubscriptions.id, id)),
      )
      .returning();
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'webhook.updated',
      target: { type: 'webhook', id },
      before: { url: current.url, events: current.events, status: current.status },
      after: { url: row!.url, events: row!.events, status: row!.status },
    });
    return this.result(tx, row!);
  }

  /** A new signing secret, shown now; messages signed from here on use it. */
  async rotate(
    tx: TenantTx,
    access: Access,
    id: string,
  ): Promise<{ webhook: WebhookResult; secret: string }> {
    await this.locked(tx, access.tenantId, id);
    const secret = newWebhookSecret();
    const [row] = await tx
      .update(webhookSubscriptions)
      .set({
        secretSealed: this.cipher.seal(secret, sealedAt(id)),
        updatedAt: new Date(),
        updatedBy: access.userId,
      })
      .where(
        and(eq(webhookSubscriptions.tenantId, access.tenantId), eq(webhookSubscriptions.id, id)),
      )
      .returning();
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'webhook.secret_rotated',
      target: { type: 'webhook', id },
    });
    return { webhook: await this.result(tx, row!), secret };
  }

  /**
   * An event, as the outbox delivers it, becomes a message for each active subscription to it,
   * once each: the outbox may deliver an event again.
   */
  async fanOut(
    tx: TenantTx,
    tenantId: string,
    event: { id: string; type: WebhookEventKey; createdAt: Date },
    data: Record<string, unknown>,
  ): Promise<void> {
    const subscriptions = await tx
      .select({ id: webhookSubscriptions.id })
      .from(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.tenantId, tenantId),
          eq(webhookSubscriptions.status, 'active'),
          sql`${event.type} = any(${webhookSubscriptions.events})`,
        ),
      );
    for (const subscription of subscriptions) {
      const id = newId();
      const [made] = await tx
        .insert(webhookMessages)
        .values({
          tenantId,
          id,
          subscriptionId: subscription.id,
          eventId: event.id,
          event: event.type,
          body: {
            type: event.type,
            timestamp: event.createdAt.toISOString(),
            eventId: event.id,
            data,
          },
        })
        .onConflictDoNothing()
        .returning({ id: webhookMessages.id });
      if (made) this.enqueue(tx, tenantId, made.id, 1);
    }
  }

  /** "Send a test": one try now, with no retries, and its outcome. */
  async test(tx: TenantTx, access: Access, id: string): Promise<WebhookDelivery> {
    const subscription = await this.locked(tx, access.tenantId, id);
    const messageId = newId();
    const now = new Date();
    const body = {
      type: WEBHOOK_TEST_EVENT,
      timestamp: now.toISOString(),
      eventId: null,
      data: { webhookId: id },
    };
    await tx.insert(webhookMessages).values({
      tenantId: access.tenantId,
      id: messageId,
      subscriptionId: id,
      eventId: null,
      event: WEBHOOK_TEST_EVENT,
      body,
      status: 'pending',
      firstAttemptAt: now,
    });
    const secret = this.cipher.open(subscription.secretSealed, sealedAt(id));
    const outcome = await this.sender.send(subscription.url, secret, messageId, body, now);
    return this.record(
      tx,
      access.tenantId,
      subscription.id,
      messageId,
      WEBHOOK_TEST_EVENT,
      null,
      1,
      outcome,
      false,
    );
  }

  /** Sends a message again from its first try, as if new; the log keeps its earlier tries. */
  async replay(tx: TenantTx, access: Access, id: string, messageId: string): Promise<void> {
    await this.locked(tx, access.tenantId, id);
    const [message] = await tx
      .select()
      .from(webhookMessages)
      .where(
        and(
          eq(webhookMessages.tenantId, access.tenantId),
          eq(webhookMessages.subscriptionId, id),
          eq(webhookMessages.id, messageId),
        ),
      )
      .for('update');
    if (!message) throw notFound();
    await tx
      .update(webhookMessages)
      .set({
        status: 'pending',
        attempts: 0,
        firstAttemptAt: null,
        nextAttemptAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(webhookMessages.tenantId, access.tenantId), eq(webhookMessages.id, messageId)));
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'webhook.replayed',
      target: { type: 'webhook', id },
      after: { messageId, event: message.event },
    });
    // A fresh run of tries: their job IDs must not meet the earlier ones'.
    this.enqueue(tx, access.tenantId, messageId, 1, `r${Date.now()}`);
  }

  /**
   * One try of a message, from the worker: posted outside any transaction, then logged, and on a
   * failure tried again after the next backoff, or given up a day after the first try.
   */
  async deliver(tenantId: string, messageId: string, run = ''): Promise<void> {
    const ready = await this.database.forTenant(tenantId, async (tx) => {
      const [message] = await tx
        .select()
        .from(webhookMessages)
        .where(and(eq(webhookMessages.tenantId, tenantId), eq(webhookMessages.id, messageId)));
      if (!message || message.status !== 'pending') return null;
      const [subscription] = await tx
        .select()
        .from(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.tenantId, tenantId),
            eq(webhookSubscriptions.id, message.subscriptionId),
          ),
        );
      // A paused subscription's messages wait; resuming doesn't send what came while paused.
      if (!subscription || subscription.status !== 'active') return null;
      return { message, subscription };
    });
    if (!ready) return;
    const { message, subscription } = ready;
    const secret = this.cipher.open(subscription.secretSealed, sealedAt(subscription.id));
    const now = new Date();
    const outcome = await this.sender.send(subscription.url, secret, message.id, message.body, now);
    await this.database.forTenant(tenantId, async (tx) => {
      const attempt = message.attempts + 1;
      const firstAt = message.firstAttemptAt ?? now;
      const delay = outcome.delivered ? null : webhookRetryDelay(attempt, firstAt, now);
      await this.record(
        tx,
        tenantId,
        subscription.id,
        message.id,
        message.event,
        message.eventId,
        attempt,
        outcome,
        true,
        {
          firstAt,
          delay,
        },
      );
      if (delay !== null) this.enqueue(tx, tenantId, message.id, attempt + 1, run, delay);
    });
  }

  /** The delivery log, newest first, a page at a time. */
  async deliveries(
    tx: TenantTx,
    tenantId: string,
    id: string,
    query: { limit: number; cursor?: string | undefined },
  ): Promise<{ items: WebhookDelivery[]; nextCursor: string | null }> {
    await this.locked(tx, tenantId, id, false);
    const filters = [
      eq(webhookDeliveries.tenantId, tenantId),
      eq(webhookDeliveries.subscriptionId, id),
    ];
    if (query.cursor) {
      const [at, deliveryId] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('|');
      if (at && deliveryId) {
        filters.push(
          or(
            lt(webhookDeliveries.createdAt, new Date(at)),
            and(
              eq(webhookDeliveries.createdAt, new Date(at)),
              lt(webhookDeliveries.id, deliveryId),
            ),
          )!,
        );
      }
    }
    const rows = await tx
      .select({
        delivery: webhookDeliveries,
        event: webhookMessages.event,
        eventId: webhookMessages.eventId,
        messageStatus: webhookMessages.status,
      })
      .from(webhookDeliveries)
      .innerJoin(
        webhookMessages,
        and(
          eq(webhookMessages.tenantId, webhookDeliveries.tenantId),
          eq(webhookMessages.id, webhookDeliveries.messageId),
        ),
      )
      .where(and(...filters))
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1]?.delivery;
    return {
      items: page.map(({ delivery, event, eventId, messageStatus }) => ({
        id: delivery.id,
        messageId: delivery.messageId,
        event,
        eventId,
        attempt: delivery.attempt,
        status: delivery.status === 'delivered' ? 'delivered' : 'failed',
        responseCode: delivery.responseCode,
        durationMs: delivery.durationMs,
        error: delivery.error,
        messageStatus: messageStatus as WebhookDelivery['messageStatus'],
        createdAt: delivery.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString('base64url')
          : null,
    };
  }

  /** Logs a try and moves the message: delivered, waiting for its next try, or given up. */
  private async record(
    tx: TenantTx,
    tenantId: string,
    subscriptionId: string,
    messageId: string,
    event: string,
    eventId: string | null,
    attempt: number,
    outcome: {
      delivered: boolean;
      responseCode: number | null;
      durationMs: number;
      error: string | null;
    },
    retries: boolean,
    timing: { firstAt: Date; delay: number | null } = { firstAt: new Date(), delay: null },
  ): Promise<WebhookDelivery> {
    const id = newId();
    const createdAt = new Date();
    await tx.insert(webhookDeliveries).values({
      tenantId,
      id,
      subscriptionId,
      messageId,
      attempt,
      status: outcome.delivered ? 'delivered' : 'failed',
      responseCode: outcome.responseCode,
      durationMs: outcome.durationMs,
      error: outcome.error,
      createdAt,
    });
    const messageStatus = outcome.delivered
      ? 'delivered'
      : retries && timing.delay !== null
        ? 'pending'
        : 'failed';
    await tx
      .update(webhookMessages)
      .set({
        status: messageStatus,
        attempts: attempt,
        firstAttemptAt: timing.firstAt,
        nextAttemptAt: timing.delay !== null ? new Date(createdAt.getTime() + timing.delay) : null,
        updatedAt: createdAt,
      })
      .where(and(eq(webhookMessages.tenantId, tenantId), eq(webhookMessages.id, messageId)));
    return {
      id,
      messageId,
      event,
      eventId,
      attempt,
      status: outcome.delivered ? 'delivered' : 'failed',
      responseCode: outcome.responseCode,
      durationMs: outcome.durationMs,
      error: outcome.error,
      messageStatus,
      createdAt: createdAt.toISOString(),
    };
  }

  /** Queues a try once the transaction commits. */
  private enqueue(
    tx: TenantTx,
    tenantId: string,
    messageId: string,
    attempt: number,
    run = '',
    delay = 0,
  ) {
    this.database.afterCommit(tx, () =>
      this.queues.add(
        'webhooks',
        DELIVER,
        { tenantId, messageId, run },
        {
          jobId: `${jobId(messageId, attempt)}${run ? `.${run}` : ''}`,
          ...(delay ? { delay } : {}),
        },
      ),
    );
  }

  private async locked(
    tx: TenantTx,
    tenantId: string,
    id: string,
    lock = true,
  ): Promise<Subscription> {
    const query = tx
      .select()
      .from(webhookSubscriptions)
      .where(and(eq(webhookSubscriptions.tenantId, tenantId), eq(webhookSubscriptions.id, id)));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw notFound();
    return row;
  }

  private async result(tx: TenantTx, row: Subscription): Promise<WebhookResult> {
    const [last] = await tx
      .select({
        status: webhookDeliveries.status,
        responseCode: webhookDeliveries.responseCode,
        at: webhookDeliveries.createdAt,
      })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.tenantId, row.tenantId),
          eq(webhookDeliveries.subscriptionId, row.id),
        ),
      )
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(1);
    return {
      id: row.id,
      url: row.url,
      events: row.events as WebhookEventKey[],
      description: row.description,
      status: row.status === 'paused' ? 'paused' : 'active',
      createdAt: row.createdAt.toISOString(),
      lastDelivery: last
        ? {
            status: last.status === 'delivered' ? 'delivered' : 'failed',
            responseCode: last.responseCode,
            at: last.at.toISOString(),
          }
        : null,
    };
  }
}
