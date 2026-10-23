import { z } from 'zod';
import { REQUEST_TYPES, SKIP_REASONS } from '../workflow';

/**
 * Approvals (spec 5.9, M15). Each request type's chain is the tenant's (decision D74); a type
 * without one goes to the requester's manager for one decision, as in phase 1 (decision D38).
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
  /** Why the step was passed over when the request started (BR-31). */
  skipReason: z.enum(SKIP_REASONS).nullable(),
  /** Nobody resolved, or nobody decided in time, so the step went to its escalation role. */
  escalated: z.boolean(),
  /** The tenant's fallback approvers, because no step of the chain remained. */
  fallback: z.boolean(),
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
    /** Whether the requester may still withdraw it: nobody has decided any step yet. */
    cancellable: z.boolean(),
    /** Whether its type may be approved with others in one go from the inbox (M15). */
    bulk: z.boolean(),
    /** Where the portal decides it, for a request decided only on its own page (decision D78). */
    page: z.string().nullable(),
    createdAt: z.iso.datetime(),
    closedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Approval' });

export const ApprovalInboxQuery = z.strictObject({
  requestType: RequestType.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

/**
 * `GET /v1/approvals/inbox`: what waits for the caller, oldest first, and how many of each type
 * wait in all, whatever the filter (M15).
 */
export const ApprovalInboxResult = z.object({
  items: z.array(ApprovalResult),
  nextCursor: z.uuid().nullable(),
  counts: z.partialRecord(RequestType, z.int().min(1)),
});

/** `GET /v1/approvals/mine`: the caller's own requests, newest first (M15). */
export const ApprovalMineQuery = z.strictObject({
  status: ApprovalStatus.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

export const ApprovalMineResult = z.object({
  items: z.array(ApprovalResult),
  nextCursor: z.uuid().nullable(),
});

/**
 * `POST /v1/approvals/decisions`: approves several requests in one go, where their types allow it
 * (M15). Each is decided on its own, on the version shown; one refused leaves the others decided.
 */
export const BulkApprovalBody = z.strictObject({
  items: z
    .array(z.strictObject({ id: z.uuid(), version: z.int().min(1) }))
    .min(1)
    .max(50),
});

export const BulkApprovalResult = z.object({
  results: z.array(
    z.object({
      id: z.uuid(),
      /** The request after the approval, or null when it was refused. */
      approval: ApprovalResult.nullable(),
      error: z.object({ code: z.string(), message: z.string() }).nullable(),
    }),
  ),
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
export type ApprovalMineQuery = z.output<typeof ApprovalMineQuery>;
export type ApprovalMineResult = z.infer<typeof ApprovalMineResult>;
export type BulkApprovalBody = z.output<typeof BulkApprovalBody>;
export type BulkApprovalResult = z.infer<typeof BulkApprovalResult>;
export type ApprovalDecisionBody = z.output<typeof ApprovalDecisionBody>;
