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

/** A shift started or ended (M5): attendance days, trails and the live map follow it. */
export const ShiftEventPayload = z.object({
  shiftId: z.uuid(),
  userId: z.uuid(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});

/** A visit checked in or out (M6): plan items (step 11) and metrics follow it. */
export const VisitEventPayload = z.object({
  visitId: z.uuid(),
  userId: z.uuid(),
  accountId: z.uuid(),
  checkInAt: z.iso.datetime(),
  checkOutAt: z.iso.datetime().nullable(),
});

/** A submission received (M6): the media worker renders its signature, review and metrics follow. */
export const SubmissionEventPayload = z.object({
  submissionId: z.uuid(),
  userId: z.uuid(),
  formKey: z.string(),
  accountId: z.uuid().nullable(),
  visitId: z.uuid().nullable(),
  capturedAt: z.iso.datetime(),
  status: z.enum(['pending', 'approved', 'rejected']),
});

/** A photo processed (spec 12.2): the record holding it, if any, learns of a duplicate (BR-40). */
export const MediaProcessedPayload = z.object({
  mediaId: z.uuid(),
  ownerType: z.string().nullable(),
  ownerId: z.uuid().nullable(),
  duplicateOfId: z.uuid().nullable(),
});

export const EVENT_PAYLOADS = {
  'user.created': UserEventPayload,
  'user.updated': UserEventPayload,
  'user.deactivated': UserEventPayload,
  'tenant.provisioned': TenantProvisionedPayload,
  'shift.started': ShiftEventPayload,
  'shift.ended': ShiftEventPayload,
  'visit.started': VisitEventPayload,
  'visit.ended': VisitEventPayload,
  'submission.created': SubmissionEventPayload,
  'media.processed': MediaProcessedPayload,
} as const;

export type EventType = keyof typeof EVENT_PAYLOADS;
export type EventPayload<T extends EventType> = z.output<(typeof EVENT_PAYLOADS)[T]>;

export const EVENT_TYPES = Object.keys(EVENT_PAYLOADS) as EventType[];
