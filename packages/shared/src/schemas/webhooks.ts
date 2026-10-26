import { z } from 'zod';
import { WEBHOOK_EVENTS } from '../webhooks';

/** Webhook subscriptions and their deliveries (module M20, decision D94). */

export const WebhookEvent = z.enum(WEBHOOK_EVENTS);

const Events = z
  .array(WebhookEvent)
  .min(1)
  .refine((events) => new Set(events).size === events.length, 'List each event once');

/** `POST /v1/webhooks`: made under the portal's own ID; its signing secret comes back once. */
export const CreateWebhookBody = z
  .strictObject({
    id: z.uuid(),
    url: z.url().max(500),
    events: Events,
    description: z.string().trim().max(200).optional(),
  })
  .meta({ id: 'CreateWebhookBody' });

/** `PATCH /v1/webhooks/{id}`: where it posts, what it hears, and whether it is on. */
export const UpdateWebhookBody = z
  .strictObject({
    url: z.url().max(500).optional(),
    events: Events.optional(),
    description: z.string().trim().max(200).nullable().optional(),
    status: z.enum(['active', 'paused']).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change')
  .meta({ id: 'UpdateWebhookBody' });

export const WebhookResult = z
  .object({
    id: z.uuid(),
    url: z.string(),
    events: z.array(WebhookEvent),
    description: z.string().nullable(),
    status: z.enum(['active', 'paused']),
    createdAt: z.iso.datetime(),
    /** The latest try of any message, to see at a glance whether it is reaching its receiver. */
    lastDelivery: z
      .object({
        status: z.enum(['delivered', 'failed']),
        responseCode: z.int().nullable(),
        at: z.iso.datetime(),
      })
      .nullable(),
  })
  .meta({ id: 'Webhook' });

export const WebhookList = z.object({ items: z.array(WebhookResult) });

/** A webhook with its signing secret, shown only now: on making it, or on rotating the secret. */
export const WebhookSecret = z
  .object({ webhook: WebhookResult, secret: z.string() })
  .meta({ id: 'WebhookSecret' });

/** One try of one message, as the delivery log shows it. */
export const WebhookDelivery = z
  .object({
    id: z.uuid(),
    messageId: z.uuid(),
    event: z.string(),
    eventId: z.uuid().nullable(),
    attempt: z.int().min(1),
    status: z.enum(['delivered', 'failed']),
    responseCode: z.int().nullable(),
    durationMs: z.int().nullable(),
    error: z.string().nullable(),
    /** Whether the message is still being tried, was delivered, or gave up. */
    messageStatus: z.enum(['pending', 'delivered', 'failed']),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'WebhookDelivery' });

export const WebhookDeliveryQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

export const WebhookDeliveryList = z.object({
  items: z.array(WebhookDelivery),
  nextCursor: z.string().nullable(),
});

export const WebhookMessageParams = z.strictObject({ id: z.uuid(), messageId: z.uuid() });

/** A message sent again is queued; its tries appear in the log. */
export const WebhookReplayResult = z.object({ queued: z.literal(true) });

export type CreateWebhookBody = z.output<typeof CreateWebhookBody>;
export type UpdateWebhookBody = z.output<typeof UpdateWebhookBody>;
export type WebhookResult = z.infer<typeof WebhookResult>;
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;
