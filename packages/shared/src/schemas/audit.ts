import { z } from 'zod';

/**
 * The audit log (module M21): who changed what, from where, with the values before and after.
 * Entries are never changed or deleted, except when retention drops a whole month (D9).
 */

export const AUDIT_ACTOR_KINDS = ['user', 'platform', 'system', 'api_client'] as const;

/** Every action the log records. Add new ones, never rename old ones. */
export const AUDIT_ACTIONS = [
  'user.created',
  'user.updated',
  'user.device_reset',
  'user.signed_out_everywhere',
  'user_fields.replaced',
  'transfer.scheduled',
  'transfer.applied',
  'transfer.cancelled',
  'transfer.failed',
  'territory.created',
  'territory.updated',
  'import.uploaded',
  'import.committed',
  'account_type.published',
  'form.published',
  'form.updated',
  'account.created',
  'account.proposed',
  'account.updated',
  'account.slots_changed',
  'account.location_proposed',
  'contact.created',
  'contact.updated',
  'approval.requested',
  'approval.decided',
  'role.created',
  'role.updated',
  'designation.created',
  'designation.updated',
  'settings.updated',
  'terminology.replaced',
  'shift.started',
  'shift.ended',
  'shift.paused',
  'shift.resumed',
  'visit.checked_in',
  'visit.checked_out',
  'submission.created',
  'submission.reviewed',
  'review_rules.updated',
  'route.created',
  'route.updated',
  'plan.generated',
  'plan.submitted',
  'plan.decided',
  'plan_item.created',
  'plan_item.cancelled',
  'plan_item.status_changed',
  'target.updated',
  'target.locked',
  'target.unlocked',
  'account_plan.updated',
  'session.signed_in',
  'session.device_refused',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

export const AuditEntry = z.object({
  id: z.uuid(),
  actor: z.object({ kind: z.enum(AUDIT_ACTOR_KINDS), id: z.uuid().nullable() }),
  action: z.enum(AUDIT_ACTIONS),
  target: z.object({ type: z.string(), id: z.uuid().nullable() }),
  before: z.unknown(),
  after: z.unknown(),
  ip: z.string().nullable(),
  deviceId: z.uuid().nullable(),
  /** Set when vendor staff acted under a support grant (module M22). */
  supportGrantId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

/** `GET /v1/audit`: newest first, a page at a time, with optional filters. */
export const AuditListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  targetType: z
    .string()
    .regex(/^[a-z_]{1,40}$/)
    .optional(),
  targetId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const AuditListResult = z.object({
  items: z.array(AuditEntry),
  nextCursor: z.string().nullable(),
});

export type AuditEntry = z.output<typeof AuditEntry>;
export type AuditListQuery = z.output<typeof AuditListQuery>;
export type AuditListResult = z.output<typeof AuditListResult>;
