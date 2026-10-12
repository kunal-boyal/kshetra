import { z } from 'zod';
import { GeoPoint } from '../geo';

/**
 * Media (spec 12.2): photos taken on phones, uploaded straight to storage, then processed. Each
 * file's ID is made on the phone, so a retried upload is the same file.
 */

/** What a photo is for; imports and exports keep their own kinds on the server. */
export const PHOTO_KINDS = [
  'evidence',
  'field_photo',
  'selfie',
  'attachment',
  'receipt',
  'odometer',
  'signature',
] as const;
export const PhotoKind = z.enum(PHOTO_KINDS);

export const MEDIA_SOURCES = ['camera', 'gallery', 'generated'] as const;
export const MediaSource = z.enum(MEDIA_SOURCES);

export const MEDIA_STATUSES = ['pending', 'uploaded', 'processed', 'rejected', 'deleted'] as const;
export const MediaStatus = z.enum(MEDIA_STATUSES);

export const MEDIA_VARIANTS = ['original', 'stamped', 'thumbnail'] as const;
export const MediaVariant = z.enum(MEDIA_VARIANTS);

/** The largest photo a phone may send: a 1,600 px JPEG is far smaller. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const Sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Send the SHA-256 as 64 lowercase hexadecimal characters');

/** `POST /v1/media/presign` (spec 12.2, step 2). */
export const PresignMediaBody = z.strictObject({
  id: z.uuid(),
  kind: PhotoKind,
  contentType: z.literal('image/jpeg'),
  size: z.int().min(1).max(MAX_PHOTO_BYTES),
  sha256: Sha256,
});

/**
 * Where to send the bytes, valid for 10 minutes, with the headers the upload must carry: storage
 * refuses a different type, length or checksum. Null when the file is there already.
 */
export const PresignMediaResult = z.object({
  id: z.uuid(),
  status: MediaStatus,
  upload: z
    .object({
      url: z.url(),
      method: z.literal('PUT'),
      headers: z.record(z.string(), z.string()),
      expiresAt: z.iso.datetime(),
    })
    .nullable(),
});

/** Where the phone was when the photo was taken. */
export const MediaFix = GeoPoint.extend({
  accuracy: z.number().min(0).max(100_000),
  capturedAt: z.iso.datetime({ offset: true }),
  mocked: z.boolean().default(false),
});

/** `POST /v1/media/{id}/confirm` (step 3): the bytes are up; when, where and how it was taken. */
export const ConfirmMediaBody = z.strictObject({
  capturedAt: z.iso.datetime({ offset: true }),
  source: MediaSource,
  fix: MediaFix.nullable().default(null),
});

export const MediaResult = z
  .object({
    id: z.uuid(),
    kind: PhotoKind,
    status: MediaStatus,
    size: z.int(),
    sha256: z.string(),
    source: MediaSource.nullable(),
    capturedAt: z.iso.datetime().nullable(),
    point: GeoPoint.nullable(),
    accuracy: z.number().nullable(),
    /** BR-40: the earlier photo it repeats, flagged for reviewers, never blocked. */
    duplicateOfId: z.uuid().nullable(),
    /** Why processing refused it, such as bytes that don't match their checksum. */
    rejectReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Media' });

export const MediaUrlQuery = z.strictObject({ variant: MediaVariant.default('stamped') });

/** `GET /v1/media/{id}/url` (step 6): a signed link to one variant, for 5 minutes. */
export const MediaUrlResult = z.object({ url: z.url(), expiresAt: z.iso.datetime() });

export type PhotoKind = z.infer<typeof PhotoKind>;
export type MediaSource = z.infer<typeof MediaSource>;
export type MediaStatus = z.infer<typeof MediaStatus>;
export type MediaVariant = z.infer<typeof MediaVariant>;
export type PresignMediaBody = z.output<typeof PresignMediaBody>;
export type PresignMediaResult = z.infer<typeof PresignMediaResult>;
export type MediaFix = z.output<typeof MediaFix>;
export type ConfirmMediaBody = z.output<typeof ConfirmMediaBody>;
export type MediaResult = z.infer<typeof MediaResult>;
export type MediaUrlQuery = z.output<typeof MediaUrlQuery>;
export type MediaUrlResult = z.infer<typeof MediaUrlResult>;
