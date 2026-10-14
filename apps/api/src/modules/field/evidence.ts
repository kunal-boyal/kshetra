import { AppError, type EvidenceIssue } from '@kshetra/shared';

const MESSAGES: Record<EvidenceIssue['code'], string> = {
  GPS_MOCKED: 'This location is mocked. Turn off any app that fakes it.',
  GPS_INACCURATE: 'This location is not accurate enough. Try again in the open.',
  GPS_STALE: 'This location was taken too long before the capture. Take it again.',
  VALIDATION: 'This was captured in the future. Check the phone clock.',
  SYNC_WINDOW: 'This was captured too long ago to count.',
  NOT_ON_SHIFT: 'Start your day before recording this.',
  OUTSIDE_SHIFT: 'This was captured outside your shift.',
  SHIFT_EXPIRED: 'This was captured past the longest a shift may last.',
};

/** Refuses a record whose evidence fails BR-32: the first problem's code, every problem listed. */
export function refuseEvidence(issues: readonly EvidenceIssue[]): void {
  const [first] = issues;
  if (!first) return;
  throw new AppError(
    first.code,
    MESSAGES[first.code],
    issues.map(({ path, issue }) => ({ path, issue })),
  );
}

/** Refuses a capture outside a `required` geofence (BR-33), saying how far away it was. */
export function refuseOutsideGeofence(distanceM: number | null, radiusM: number): never {
  throw new AppError(
    'OUTSIDE_GEOFENCE',
    `You are ${Math.round(distanceM ?? 0)} m away; this needs you within ${radiusM} m.`,
    [{ path: 'fix.location', issue: `${Math.round(distanceM ?? 0)} m from the place` }],
  );
}
