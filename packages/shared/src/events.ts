import { z } from 'zod';
import { ORDER_STATUSES } from './orders';
import { isPeriodKey } from './periods';
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

/**
 * An order placed, or its status changed (M10, BR-19, decision D78): metrics recompute the
 * placing person's day, and phones learn where their orders stand.
 */
export const OrderEventPayload = z.object({
  orderId: z.uuid(),
  userId: z.uuid(),
  accountId: z.uuid(),
  visitId: z.uuid().nullable(),
  placedAt: z.iso.datetime(),
  status: z.enum(ORDER_STATUSES),
});

/** A photo processed (spec 12.2): the record holding it, if any, learns of a duplicate (BR-40). */
export const MediaProcessedPayload = z.object({
  mediaId: z.uuid(),
  ownerType: z.string().nullable(),
  ownerId: z.uuid().nullable(),
  duplicateOfId: z.uuid().nullable(),
});

/**
 * A submission's status changed by review (M7): metrics recount it (step 12) and its plan item
 * follows (step 11, BR-35).
 */
export const SubmissionReviewedPayload = z.object({
  submissionId: z.uuid(),
  userId: z.uuid(),
  formKey: z.string(),
  accountId: z.uuid().nullable(),
  visitId: z.uuid().nullable(),
  capturedAt: z.iso.datetime(),
  before: z.enum(['pending', 'approved', 'rejected']),
  status: z.enum(['approved', 'rejected']),
  auto: z.boolean(),
  /** Who decided, when a person did, and what they wrote: the submitter hears of a rejection. */
  reviewerId: z.uuid().nullable().optional(),
  note: z.string().nullable().optional(),
});

/** A plan item's status moved (M8, BR-35): plan compliance follows it (step 12). */
export const PlanItemStatusChangedPayload = z.object({
  planItemId: z.uuid(),
  userId: z.uuid(),
  accountId: z.uuid(),
  date: z.iso.date(),
  before: z.enum(['planned', 'visited', 'completed', 'missed', 'cancelled']),
  status: z.enum(['planned', 'visited', 'completed', 'missed', 'cancelled']),
});

/** A person's targets for a month were locked or unlocked (M8, BR-08): scores follow (step 12). */
export const TargetSetEventPayload = z.object({
  targetSetId: z.uuid(),
  userId: z.uuid(),
  /** A month, quarter or year (D108). */
  period: z.string().refine(isPeriodKey),
});

/** A request now waits for these approvers (M16: they hear of it). */
export const ApprovalRequestedPayload = z.object({
  approvalId: z.uuid(),
  requestType: z.string(),
  requesterId: z.uuid(),
  approverIds: z.array(z.uuid()),
});

/**
 * A step of a request began waiting for people who weren't asked before, or was left too long
 * (M16: they hear of it): the next step after an approval, an escalation, or a reminder (D74).
 */
export const ApprovalWaitingPayload = z.object({
  approvalId: z.uuid(),
  requestType: z.string(),
  requesterId: z.uuid(),
  approverIds: z.array(z.uuid()),
  stepIndex: z.int().min(0),
  reason: z.enum(['next_step', 'escalated', 'reminder']),
});

/** A request was decided (M16: the requester hears of it). */
export const ApprovalDecidedPayload = z.object({
  approvalId: z.uuid(),
  requestType: z.string(),
  requesterId: z.uuid(),
  deciderId: z.uuid(),
  outcome: z.enum(['approved', 'rejected']),
});

/** An import finished, committed or failed (M16: the person who started it hears of it). */
export const ImportFinishedPayload = z.object({
  importId: z.uuid(),
  userId: z.uuid(),
  target: z.string(),
  fileName: z.string(),
  status: z.enum(['committed', 'failed']),
  created: z.int().min(0).nullable(),
  updated: z.int().min(0).nullable(),
});

/** An export finished, its file ready or the work failed (M18: whoever asked hears of it). */
export const ExportFinishedPayload = z.object({
  exportId: z.uuid(),
  userId: z.uuid(),
  report: z.string(),
  period: z.string(),
  status: z.enum(['ready', 'failed']),
  rows: z.int().min(0).nullable(),
});

/** An account made or changed (spec 12.4, decision D94): webhooks tell the tenant's systems. */
export const AccountEventPayload = z.object({
  accountId: z.uuid(),
  typeKey: z.string(),
  code: z.string(),
  status: z.enum(['pending', 'active', 'inactive']),
});

/** Who fills one of an account's slots changed, from a day on; null empties it. */
export const AccountAssignmentPayload = z.object({
  accountId: z.uuid(),
  slot: z.string(),
  userId: z.uuid().nullable(),
  from: z.iso.date(),
});

/** Vendor support asked to enter the tenant (M22, decision D93): its admins hear of it. */
export const SupportRequestedPayload = z.object({
  grantId: z.uuid(),
  staffName: z.string(),
  reason: z.string(),
  scope: z.enum(['read', 'write']),
  hours: z.int().min(1),
  emergency: z.boolean(),
});

/** Vendor support entered the tenant in an emergency, on a second vendor admin's word. */
export const SupportEmergencyPayload = z.object({
  grantId: z.uuid(),
  staffName: z.string(),
  reason: z.string(),
  endsAt: z.iso.datetime(),
});

/**
 * Metric definitions changed (M2): people's facts from `from`, a date on the tenant's clock, are
 * worked out again.
 */
export const MetricsChangedPayload = z.object({
  from: z.iso.date(),
  keys: z.array(z.string()),
});

export const EVENT_PAYLOADS = {
  'user.created': UserEventPayload,
  'user.updated': UserEventPayload,
  'user.deactivated': UserEventPayload,
  /** A person's personal data was erased (decision D95): the directory forgets them. */
  'user.erased': z.object({ userId: z.uuid() }),
  'tenant.provisioned': TenantProvisionedPayload,
  'shift.started': ShiftEventPayload,
  'shift.ended': ShiftEventPayload,
  'visit.started': VisitEventPayload,
  'visit.ended': VisitEventPayload,
  'submission.created': SubmissionEventPayload,
  'order.placed': OrderEventPayload,
  'order.status_changed': OrderEventPayload,
  'media.processed': MediaProcessedPayload,
  'submission.reviewed': SubmissionReviewedPayload,
  'plan_item.status_changed': PlanItemStatusChangedPayload,
  'target.locked': TargetSetEventPayload,
  'target.unlocked': TargetSetEventPayload,
  'approval.requested': ApprovalRequestedPayload,
  'approval.decided': ApprovalDecidedPayload,
  'approval.waiting': ApprovalWaitingPayload,
  'import.finished': ImportFinishedPayload,
  'export.finished': ExportFinishedPayload,
  'metrics.changed': MetricsChangedPayload,
  'support.requested': SupportRequestedPayload,
  'support.emergency': SupportEmergencyPayload,
  'account.created': AccountEventPayload,
  'account.updated': AccountEventPayload,
  'account.assignment_changed': AccountAssignmentPayload,
} as const;

export type EventType = keyof typeof EVENT_PAYLOADS;
export type EventPayload<T extends EventType> = z.output<(typeof EVENT_PAYLOADS)[T]>;

export const EVENT_TYPES = Object.keys(EVENT_PAYLOADS) as EventType[];
