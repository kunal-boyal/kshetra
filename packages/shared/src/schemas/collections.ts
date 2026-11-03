import { z } from 'zod';
import { COLLECTION_MODES, COLLECTION_STATUSES } from '../collections';
import { Money } from './config';
import { CaptureFix } from './field';
import { Period } from './planning';

/**
 * Collections (module M11, BR-63, decision D132): money taken from an account in the field, made
 * on the phone with its own ID, and confirmed by the office. They stand beside the books and are
 * matched to the books' receipts.
 */

export const CollectionMode = z.enum(COLLECTION_MODES);
export const CollectionStatus = z.enum(COLLECTION_STATUSES);

const Text = (max: number) => z.string().trim().max(max).nullable().default(null);

/** `POST /v1/collections`, sent once by the phone with its own ID. */
export const RecordCollectionBody = z
  .strictObject({
    id: z.uuid(),
    accountId: z.uuid(),
    /** The visit it was taken on, if any. */
    visitId: z.uuid().nullable().default(null),
    amount: Money,
    mode: CollectionMode,
    /** The UPI or bank transfer's reference. */
    reference: Text(60),
    chequeNumber: Text(20),
    chequeBank: Text(80),
    chequeDate: z.iso.date().nullable().default(null),
    note: Text(500),
    /** Photos of the cheque (media kind `collection`). */
    photos: z.array(z.uuid()).max(3).default([]),
    fix: CaptureFix.nullable().default(null),
    collectedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'RecordCollectionBody' });

const Who = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

export const CollectionResult = z
  .object({
    id: z.uuid(),
    /** As people read it, such as `COL-000123`. */
    number: z.string(),
    account: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    collector: Who,
    collectedOn: z.iso.date(),
    collectedAt: z.iso.datetime(),
    amount: Money,
    mode: CollectionMode,
    reference: z.string().nullable(),
    chequeNumber: z.string().nullable(),
    chequeBank: z.string().nullable(),
    chequeDate: z.iso.date().nullable(),
    note: z.string().nullable(),
    photos: z.array(z.uuid()),
    /** Whether it was taken within the account's geofence; null without a fix or a location. */
    inGeofence: z.boolean().nullable(),
    status: CollectionStatus,
    /** Why it was rejected or bounced. */
    reason: z.string().nullable(),
    decidedBy: Who.nullable(),
    decidedAt: z.iso.datetime().nullable(),
    /** The books' receipt it was matched to, and whether by hand. */
    receipt: z
      .object({ id: z.uuid(), number: z.string(), date: z.iso.date(), byHand: z.boolean() })
      .nullable(),
    /** What the caller may do with it now. */
    can: z.object({
      decide: z.boolean(),
      bounce: z.boolean(),
      match: z.boolean(),
      unmatch: z.boolean(),
    }),
  })
  .meta({ id: 'Collection' });

/** `GET /v1/collections`: the caller's own, or those in their reach with `collection.view`. */
export const CollectionListQuery = z.strictObject({
  status: CollectionStatus.optional(),
  accountId: z.uuid().optional(),
  userId: z.uuid().optional(),
  /** A month on the tenant's clock, by the day collected. */
  period: Period.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

export const CollectionListResult = z.object({
  items: z.array(CollectionResult),
  nextCursor: z.uuid().nullable(),
  /** With the first page only (null after), under the filters but status: count and amount by status. */
  summary: z
    .object({
      counts: z.partialRecord(CollectionStatus, z.int()),
      amounts: z.partialRecord(CollectionStatus, Money),
    })
    .nullable(),
});

/** `POST /v1/collections/decisions`: the office confirms or rejects several, each on its own. */
export const CollectionDecisionsBody = z.strictObject({
  items: z
    .array(
      z
        .strictObject({
          id: z.uuid(),
          decision: z.enum(['confirm', 'reject']),
          reason: z.string().trim().max(500).optional(),
        })
        .refine((item) => item.decision === 'confirm' || (item.reason?.length ?? 0) >= 3, {
          message: 'Say why, in at least 3 characters',
          path: ['reason'],
        }),
    )
    .min(1)
    .max(50),
});

export const CollectionDecisionsResult = z.object({
  results: z.array(
    z.object({
      id: z.uuid(),
      /** The collection after the decision, or null when it was refused. */
      collection: CollectionResult.nullable(),
      error: z.object({ code: z.string(), message: z.string() }).nullable(),
    }),
  ),
});

/** `POST /v1/collections/{id}/bounce`: a confirmed cheque came back unpaid. */
export const BounceCollectionBody = z.strictObject({
  reason: z.string().trim().min(3, 'Say why, in at least 3 characters').max(500),
});

/** `POST /v1/collections/{id}/match`: the books' receipt for it, matched by hand. */
export const MatchCollectionBody = z.strictObject({ receiptId: z.uuid() });

export type RecordCollectionBody = z.output<typeof RecordCollectionBody>;
export type CollectionResult = z.infer<typeof CollectionResult>;
export type CollectionListQuery = z.output<typeof CollectionListQuery>;
export type CollectionListResult = z.infer<typeof CollectionListResult>;
export type CollectionDecisionsBody = z.output<typeof CollectionDecisionsBody>;
export type CollectionDecisionsResult = z.infer<typeof CollectionDecisionsResult>;
export type BounceCollectionBody = z.output<typeof BounceCollectionBody>;
export type MatchCollectionBody = z.output<typeof MatchCollectionBody>;
