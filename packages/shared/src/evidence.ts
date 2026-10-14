import type { ErrorCode } from './errors';
import { distanceMeters, type GeoPoint } from './geo';
import { POINT_EARLY_MS, SHIFT_FIX_ACCURACY_M, type ShiftWindow } from './tracking';

/**
 * Evidence for what people record in the field (M6, BR-32, BR-33): the rules the server applies
 * to every visit and submission, and the app previews. Times are epoch milliseconds.
 */

/** A fix this much older than the capture is stale (BR-32). */
export const FIX_MAX_AGE_MS = 120_000;
/** A capture this far ahead of the server's clock is in the future (BR-32). */
export const FUTURE_TOLERANCE_MS = 120_000;
/** A photo is taken within this long of its submission... */
export const PHOTO_MAX_GAP_MS = 5 * 60_000;
/** ...and this close to where it was submitted (BR-32). */
export const PHOTO_MAX_DISTANCE_M = 500;

export type GeofenceResult = 'inside' | 'outside' | 'unknown';

/**
 * BR-33: inside when the distance is at most the radius plus the fix's accuracy, the accuracy
 * capped at the tenant's credit. Without a verified location to measure from, `unknown`.
 */
export function geofenceResult(input: {
  /** Metres from the fix to the account's verified location, or null without one. */
  distanceM: number | null;
  radiusM: number;
  accuracyM: number;
  /** The tenant's accuracy credit cap (`geofenceAccuracyCapMeters`, 100 m by default). */
  accuracyCapM: number;
}): GeofenceResult {
  if (input.distanceM === null) return 'unknown';
  const credit = Math.min(Math.max(0, input.accuracyM), Math.max(0, input.accuracyCapM));
  return input.distanceM <= input.radiusM + credit ? 'inside' : 'outside';
}

/** A problem with a record's evidence, as the API reports it. */
export interface EvidenceIssue {
  code: Extract<
    ErrorCode,
    | 'GPS_STALE'
    | 'GPS_INACCURATE'
    | 'GPS_MOCKED'
    | 'NOT_ON_SHIFT'
    | 'OUTSIDE_SHIFT'
    | 'SHIFT_EXPIRED'
    | 'SYNC_WINDOW'
    | 'VALIDATION'
  >;
  path: string;
  issue: string;
}

/**
 * BR-32 for a record's own fix and moment: a real fix of 250 m or better, at most 120 s older
 * than the capture; the capture on the person's own shift (unless the form allows off-shift
 * capture), not ahead of the server by more than 120 s, and inside the sync window. Every
 * problem, in that order; the first is the one the API answers with.
 */
export function evidenceIssues(
  record: { capturedAt: number; fix: { capturedAt: number; accuracy: number; mocked: boolean } },
  shift: ShiftWindow | null,
  context: {
    userId: string;
    now: number;
    maxShiftHours: number;
    syncWindowHours: number;
    offShiftAllowed: boolean;
  },
): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  const { fix, capturedAt } = record;
  if (fix.mocked) {
    issues.push({ code: 'GPS_MOCKED', path: 'fix.mocked', issue: 'This location is mocked' });
  }
  if (!(fix.accuracy <= SHIFT_FIX_ACCURACY_M)) {
    issues.push({
      code: 'GPS_INACCURATE',
      path: 'fix.accuracy',
      issue: `The location is not accurate to ${SHIFT_FIX_ACCURACY_M} m`,
    });
  }
  if (
    capturedAt - fix.capturedAt > FIX_MAX_AGE_MS ||
    fix.capturedAt - capturedAt > FIX_MAX_AGE_MS
  ) {
    issues.push({
      code: 'GPS_STALE',
      path: 'fix.capturedAt',
      issue: 'The location was taken more than 2 minutes from the capture',
    });
  }
  if (capturedAt > context.now + FUTURE_TOLERANCE_MS) {
    issues.push({ code: 'VALIDATION', path: 'capturedAt', issue: 'This time is in the future' });
  }
  if (capturedAt < context.now - context.syncWindowHours * 3_600_000) {
    issues.push({
      code: 'SYNC_WINDOW',
      path: 'capturedAt',
      issue: 'This was captured too long ago to count',
    });
  }
  if (!context.offShiftAllowed) {
    if (!shift || shift.userId !== context.userId) {
      issues.push({ code: 'NOT_ON_SHIFT', path: 'shiftId', issue: 'Capture needs a shift' });
    } else if (
      capturedAt < shift.startedAt - POINT_EARLY_MS ||
      (shift.endedAt !== null && capturedAt > shift.endedAt)
    ) {
      issues.push({
        code: 'OUTSIDE_SHIFT',
        path: 'capturedAt',
        issue: 'This was captured outside the shift',
      });
    } else if (capturedAt > shift.startedAt + context.maxShiftHours * 3_600_000) {
      issues.push({
        code: 'SHIFT_EXPIRED',
        path: 'capturedAt',
        issue: 'This was captured past the longest a shift may last',
      });
    }
  }
  return issues;
}

/** A photo as a record attaches it (spec 12.2, step 5). */
export interface AttachedPhoto {
  id: string;
  userId: string | null;
  /** The record that holds it already, if any. */
  ownerId: string | null;
  capturedAt: number | null;
  point: GeoPoint | null;
  source: 'camera' | 'gallery' | 'generated' | null;
}

/**
 * BR-32 for a record's photos: each the person's own, held by no other record, and taken within
 * 5 minutes and 500 m of the record; from the gallery only where the form allows. A photo with no
 * place of its own isn't measured. Problems by photo ID.
 */
export function photoIssues(
  photos: readonly AttachedPhoto[],
  record: { id: string; userId: string; capturedAt: number; point: GeoPoint },
  policy: { galleryAllowed: boolean },
): { id: string; issue: string }[] {
  const issues: { id: string; issue: string }[] = [];
  for (const photo of photos) {
    if (photo.userId !== record.userId) {
      issues.push({ id: photo.id, issue: 'This photo was taken by someone else' });
    } else if (photo.ownerId !== null && photo.ownerId !== record.id) {
      issues.push({ id: photo.id, issue: 'This photo belongs to another record' });
    } else if (photo.source === 'gallery' && !policy.galleryAllowed) {
      issues.push({ id: photo.id, issue: 'This form takes photos from the camera only' });
    } else if (
      photo.capturedAt === null ||
      Math.abs(photo.capturedAt - record.capturedAt) > PHOTO_MAX_GAP_MS
    ) {
      issues.push({ id: photo.id, issue: 'This photo was taken more than 5 minutes apart' });
    } else if (photo.point && distanceMeters(photo.point, record.point) > PHOTO_MAX_DISTANCE_M) {
      issues.push({ id: photo.id, issue: 'This photo was taken more than 500 m away' });
    }
  }
  return issues;
}
