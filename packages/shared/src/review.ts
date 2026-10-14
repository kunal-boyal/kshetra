/**
 * Evidence review (M7): who may decide a submission, what a decision needs, and what may be
 * approved without a person. The server applies them; the web previews them.
 */

/** A rejection, and any change to a decision, carries a note at least this long. */
export const REVIEW_NOTE_MIN = 3;
/** Auto-approval waits this long after a submission arrives, unless the tenant says otherwise. */
export const AUTO_APPROVAL_DELAY_HOURS = 24;
/** At most this many submissions are approved in one bulk approval. */
export const BULK_REVIEW_MAX = 100;

/** Play Integrity verdicts that mean the device is genuine (spec 13.2). */
const GENUINE = new Set(['MEETS_DEVICE_INTEGRITY', 'MEETS_STRONG_INTEGRITY']);

/**
 * Whether a device's integrity verdict warns. A device with no verdict yet doesn't, until
 * verdicts are collected (decision D51).
 */
export function integrityWarning(verdict: string | null): boolean {
  return verdict !== null && !GENUINE.has(verdict);
}

export type ReviewRefusal = 'OWN_WORK' | 'NOTE_REQUIRED' | 'UNCHANGED';

/**
 * Why a reviewer can't record this decision, or null when they can (M7): nobody reviews their
 * own work; a rejection carries a note of 3 characters or more, and so does changing a decision
 * already made; deciding what was already decided changes nothing.
 */
export function reviewRefusal(input: {
  reviewerId: string;
  authorId: string;
  current: 'pending' | 'approved' | 'rejected';
  decision: 'approved' | 'rejected';
  note: string | null;
}): ReviewRefusal | null {
  if (input.reviewerId === input.authorId) return 'OWN_WORK';
  if (input.current === input.decision) return 'UNCHANGED';
  const noted = (input.note ?? '').trim().length >= REVIEW_NOTE_MIN;
  if ((input.decision === 'rejected' || input.current !== 'pending') && !noted) {
    return 'NOTE_REQUIRED';
  }
  return null;
}

/**
 * Whether a submission may be approved without a person (M7): no flags, not outside the
 * geofence where one applied, and from a device without integrity warnings. The tenant's switch,
 * the form's review setting and the delay are the caller's.
 */
export function autoApprovable(submission: {
  flags: readonly string[];
  geofence: 'inside' | 'outside' | 'unknown' | null;
  integrityVerdict: string | null;
}): boolean {
  return (
    submission.flags.length === 0 &&
    submission.geofence !== 'outside' &&
    !integrityWarning(submission.integrityVerdict)
  );
}
