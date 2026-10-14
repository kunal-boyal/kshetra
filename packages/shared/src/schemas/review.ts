import { z } from 'zod';
import { BULK_REVIEW_MAX } from '../review';
import { GeofenceResultKey, SubmissionFlag, SubmissionResult, SubmissionStatus } from './field';
import { MediaSource } from './media';

/** What a reviewer decides (M7). */
export const ReviewDecision = z.enum(['approved', 'rejected']);

/**
 * `POST /v1/submissions/{id}/review`: approve, or reject with a note; changing a decision
 * already made needs a note too.
 */
export const ReviewBody = z.strictObject({
  decision: ReviewDecision,
  note: z.string().trim().max(1000).optional(),
});

/** One decision on a submission, a person's or the auto-approval's. */
export const ReviewEntry = z.object({
  decision: ReviewDecision,
  note: z.string().nullable(),
  reviewer: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  auto: z.boolean(),
  at: z.iso.datetime(),
});

/** A photo as a reviewer weighs it: how it was taken, when, and how far from the submission. */
export const ReviewPhoto = z.object({
  id: z.uuid(),
  source: MediaSource.nullable(),
  capturedAt: z.iso.datetime().nullable(),
  distanceM: z.int().nullable(),
  duplicate: z.boolean(),
});

export const ReviewItem = SubmissionResult.extend({
  photoDetails: z.array(ReviewPhoto),
  /** The device's integrity verdict warned (M7); false while verdicts aren't collected. */
  integrityWarning: z.boolean(),
  /** When auto-approval will approve it, unless a reviewer acts first; null when it won't. */
  autoApproveAt: z.iso.datetime().nullable(),
  reviews: z.array(ReviewEntry),
}).meta({ id: 'ReviewItem' });

/** `GET /v1/reviews/queue`: submissions of people in the caller's scope, never their own. */
export const ReviewQueueQuery = z.strictObject({
  status: SubmissionStatus.default('pending'),
  userId: z.uuid().optional(),
  formKey: z.string().min(1).max(40).optional(),
  accountId: z.uuid().optional(),
  /** Capture dates on the tenant's clock, `YYYY-MM-DD`, both included. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  flag: SubmissionFlag.optional(),
  geofence: GeofenceResultKey.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
});

export const ReviewQueueResult = z.object({
  items: z.array(ReviewItem),
  nextCursor: z.string().nullable(),
});

/** `POST /v1/reviews/bulk`: approve many submissions without flags at once. */
export const BulkReviewBody = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(BULK_REVIEW_MAX),
});

export const BULK_SKIP_REASONS = [
  'NOT_FOUND',
  'OUT_OF_SCOPE',
  'OWN_WORK',
  'FLAGGED',
  'NOT_PENDING',
] as const;

export const BulkReviewResult = z.object({
  approved: z.array(z.uuid()),
  skipped: z.array(z.object({ id: z.uuid(), reason: z.enum(BULK_SKIP_REASONS) })),
});

/** The tenant's review rules (M7): how long auto-approval waits. The switch is a setting. */
export const ReviewRules = z.strictObject({
  delayHours: z.int().min(1).max(168),
});

export const ReviewRulesResult = ReviewRules.extend({ autoApproval: z.boolean() }).meta({
  id: 'ReviewRulesResult',
});

/** `PUT /v1/review-rules`: the switch (the `reviewAutoApproval` setting) and the delay together. */
export const UpdateReviewRulesBody = z.strictObject({
  autoApproval: z.boolean(),
  delayHours: ReviewRules.shape.delayHours,
});

export type ReviewDecision = z.output<typeof ReviewDecision>;
export type ReviewBody = z.output<typeof ReviewBody>;
export type ReviewEntry = z.output<typeof ReviewEntry>;
export type ReviewPhoto = z.output<typeof ReviewPhoto>;
export type ReviewItem = z.output<typeof ReviewItem>;
export type ReviewQueueQuery = z.output<typeof ReviewQueueQuery>;
export type ReviewQueueResult = z.output<typeof ReviewQueueResult>;
export type BulkReviewBody = z.output<typeof BulkReviewBody>;
export type BulkReviewResult = z.output<typeof BulkReviewResult>;
export type ReviewRules = z.output<typeof ReviewRules>;
export type ReviewRulesResult = z.output<typeof ReviewRulesResult>;
export type UpdateReviewRulesBody = z.output<typeof UpdateReviewRulesBody>;
