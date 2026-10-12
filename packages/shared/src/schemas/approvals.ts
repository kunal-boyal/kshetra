import { z } from 'zod';
import { REQUEST_TYPES } from '../workflow';

/**
 * Approvals (spec 5.9, M15). Phase 1 routes a field user's proposals to their manager for one
 * decision (decision D38); phase 2's engine takes the same instances over with configured chains.
 */

export const RequestType = z.enum(REQUEST_TYPES);

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const ApprovalStatus = z.enum(APPROVAL_STATUSES);

export const STEP_STATUSES = ['waiting', 'pending', 'approved', 'rejected', 'skipped'] as const;
export const StepStatus = z.enum(STEP_STATUSES);

const Person = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

export const ApprovalStep = z.object({
  index: z.int().min(0),
  approvers: z.array(Person),
  status: StepStatus,
  actedBy: Person.nullable(),
  actedAt: z.iso.datetime().nullable(),
  note: z.string().nullable(),
});

/** What a request is about, as the module that owns it describes it. */
export const ApprovalSubject = z.object({
  /** Such as an account's name and code. */
  title: z.string(),
  accountId: z.uuid().nullable(),
});

export const ApprovalResult = z
  .object({
    id: z.uuid(),
    requestType: RequestType,
    requestId: z.uuid(),
    subject: ApprovalSubject,
    requester: Person,
    status: ApprovalStatus,
    /** Send it back with a decision: a decision on an older version is refused (BR-31). */
    version: z.int().min(1),
    steps: z.array(ApprovalStep),
    createdAt: z.iso.datetime(),
    closedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Approval' });

export const ApprovalInboxQuery = z.strictObject({
  requestType: RequestType.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

/** `GET /v1/approvals/inbox`: what waits for the caller, oldest first. */
export const ApprovalInboxResult = z.object({
  items: z.array(ApprovalResult),
  nextCursor: z.uuid().nullable(),
});

/** `POST /v1/approvals/{instanceId}/decision` (BR-31): a rejection says why. */
export const ApprovalDecisionBody = z
  .strictObject({
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().max(1000).optional(),
    version: z.int().min(1),
  })
  .refine((body) => body.decision === 'approve' || (body.note?.length ?? 0) >= 3, {
    message: 'Say why, in at least 3 characters',
    path: ['note'],
  });

export type RequestType = z.infer<typeof RequestType>;
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;
export type StepStatus = z.infer<typeof StepStatus>;
export type ApprovalStep = z.infer<typeof ApprovalStep>;
export type ApprovalSubject = z.infer<typeof ApprovalSubject>;
export type ApprovalResult = z.infer<typeof ApprovalResult>;
export type ApprovalInboxQuery = z.output<typeof ApprovalInboxQuery>;
export type ApprovalInboxResult = z.infer<typeof ApprovalInboxResult>;
export type ApprovalDecisionBody = z.output<typeof ApprovalDecisionBody>;
