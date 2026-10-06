import { z } from 'zod';
import { UserStatus } from './schemas/iam';

/**
 * Domain events (spec 12.4). Each is written to the outbox in the same transaction as the change
 * it reports, then delivered at least once to the consumers inside the product and, from phase 3,
 * to webhooks. Consumers must therefore be idempotent. Names and payloads only ever grow.
 */

/** A user's sign-in facts as of the change, which is all the directory needs to stay in step. */
export const UserEventPayload = z.object({
  userId: z.uuid(),
  phone: z.string().nullable(),
  status: UserStatus,
  /** Moves with every change that signs the user out (BR-39); consumers ignore an older one. */
  authRevision: z.int().min(0),
});

/** A tenant whose configuration and first admin are in place, ready to open. */
export const TenantProvisionedPayload = z.object({
  tenantId: z.uuid(),
  templateKey: z.string(),
  templateVersion: z.int().min(1),
  /** The status the tenant opens with. */
  status: z.enum(['trial', 'active']),
});

export const EVENT_PAYLOADS = {
  'user.created': UserEventPayload,
  'user.updated': UserEventPayload,
  'user.deactivated': UserEventPayload,
  'tenant.provisioned': TenantProvisionedPayload,
} as const;

export type EventType = keyof typeof EVENT_PAYLOADS;
export type EventPayload<T extends EventType> = z.output<(typeof EVENT_PAYLOADS)[T]>;

export const EVENT_TYPES = Object.keys(EVENT_PAYLOADS) as EventType[];
