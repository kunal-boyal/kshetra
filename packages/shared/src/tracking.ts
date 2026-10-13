import { distanceMeters, type GeoPoint } from './geo';

/**
 * Shifts and location tracking (M5, spec 12.1): the rules the server applies and the app
 * previews. Times are epoch milliseconds, so callers compare without parsing twice.
 */

/** A fix this accurate or better starts or ends a shift, and makes a point count (BR-36). */
export const SHIFT_FIX_ACCURACY_M = 250;
/** A point may be this much before the shift's start, for clocks a little apart (BR-36). */
export const POINT_EARLY_MS = 5_000;
/** ...and this much after its end, for the last point the phone took while punching out. */
export const POINT_LATE_MS = 60_000;
/** A device clock further than this from the server's flags what it captured (BR-44). */
export const CLOCK_SKEW_LIMIT_S = 600;
/** Trails keep fixes this accurate or better (spec 12.1). */
export const TRAIL_ACCURACY_M = 100;
/** ...simplified to within this many metres. */
export const TRAIL_TOLERANCE_M = 10;
/** A silence longer than this between points is a gap (M5). */
export const TRAIL_GAP_MS = 10 * 60_000;

/** Why a point was refused; each is final, and the phone drops the point (spec 12.1). */
export const POINT_REJECTIONS = [
  'MOCKED',
  'INACCURATE',
  'NOT_YOUR_SHIFT',
  'OUTSIDE_SHIFT',
  'SHIFT_EXPIRED',
  'SYNC_WINDOW',
] as const;
export type PointRejection = (typeof POINT_REJECTIONS)[number];

export interface ShiftWindow {
  userId: string;
  startedAt: number;
  /** Null while the shift is open. */
  endedAt: number | null;
}

/**
 * BR-36: a point counts when it is not mocked, at most 250 m out, on the sender's own shift,
 * taken between the shift's start less 5 s and its end plus 60 s, within the longest a shift may
 * last, and inside the sync window. Null when it counts, or why not.
 */
export function pointRejection(
  point: { capturedAt: number; accuracy: number; mocked: boolean },
  shift: ShiftWindow | null,
  context: { userId: string; now: number; maxShiftHours: number; syncWindowHours: number },
): PointRejection | null {
  if (point.mocked) return 'MOCKED';
  if (!(point.accuracy <= SHIFT_FIX_ACCURACY_M)) return 'INACCURATE';
  if (!shift || shift.userId !== context.userId) return 'NOT_YOUR_SHIFT';
  if (point.capturedAt < shift.startedAt - POINT_EARLY_MS) return 'OUTSIDE_SHIFT';
  if (shift.endedAt !== null && point.capturedAt > shift.endedAt + POINT_LATE_MS) {
    return 'OUTSIDE_SHIFT';
  }
  if (point.capturedAt > shift.startedAt + context.maxShiftHours * 3_600_000) {
    return 'SHIFT_EXPIRED';
  }
  if (point.capturedAt < context.now - context.syncWindowHours * 3_600_000) return 'SYNC_WINDOW';
  return null;
}

/** The fix a punch needs (M5): fresh enough is the app's to judge; it must be real and close. */
export function punchFixIssue(fix: {
  accuracy: number;
  mocked: boolean;
}): 'GPS_MOCKED' | 'GPS_INACCURATE' | null {
  if (fix.mocked) return 'GPS_MOCKED';
  return fix.accuracy <= SHIFT_FIX_ACCURACY_M ? null : 'GPS_INACCURATE';
}

/** BR-44: whether a device's clock was too far from the server's when it sent a record. */
export function clockSkewed(skewSeconds: number | null): boolean {
  return skewSeconds !== null && Math.abs(skewSeconds) > CLOCK_SKEW_LIMIT_S;
}

/** Time on duty: the shift's length less its pauses, all clipped to the shift (M5). */
export function onDutyMs(
  shift: { startedAt: number; endedAt: number },
  pauses: readonly { pausedAt: number; resumedAt: number | null }[],
): number {
  const paused = pauses.reduce((total, pause) => {
    const from = Math.max(pause.pausedAt, shift.startedAt);
    const to = Math.min(pause.resumedAt ?? shift.endedAt, shift.endedAt);
    return total + Math.max(0, to - from);
  }, 0);
  return Math.max(0, shift.endedAt - shift.startedAt - paused);
}

export interface TrailPoint extends GeoPoint {
  capturedAt: number;
  accuracy: number;
}

/** Silences longer than 10 minutes between points, in order (M5). */
export function trailGaps(
  points: readonly TrailPoint[],
  gapMs: number = TRAIL_GAP_MS,
): { from: number; to: number }[] {
  const gaps: { from: number; to: number }[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!.capturedAt;
    const to = points[index]!.capturedAt;
    if (to - from > gapMs) gaps.push({ from, to });
  }
  return gaps;
}

/** How far `point` lies from the segment `a`–`b`, in metres, on a local flat projection. */
function offsetMeters(point: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const scale = Math.cos((a.lat * Math.PI) / 180);
  const toXY = (p: GeoPoint) => ({ x: (p.lng - a.lng) * scale, y: p.lat - a.lat });
  const p = toXY(point);
  const end = toXY(b);
  const length = end.x * end.x + end.y * end.y;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, (p.x * end.x + p.y * end.y) / length));
  const nearest = {
    lat: a.lat + t * end.y,
    lng: a.lng + (scale === 0 ? 0 : (t * end.x) / scale),
  };
  return distanceMeters(point, nearest);
}

/**
 * Douglas–Peucker simplification (spec 12.1): the fewest points that keep the line within
 * `toleranceM` of every point dropped. The first and last points always stay.
 */
export function simplifyTrail<T extends GeoPoint>(
  points: readonly T[],
  toleranceM: number = TRAIL_TOLERANCE_M,
): T[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let distance = 0;
    for (let index = first + 1; index < last; index += 1) {
      const offset = offsetMeters(points[index]!, points[first]!, points[last]!);
      if (offset > distance) {
        distance = offset;
        farthest = index;
      }
    }
    if (farthest !== -1 && distance > toleranceM) {
      keep[farthest] = true;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/** A line in Google's encoded polyline format, at five decimal places (spec 12.1). */
export function encodePolyline(points: readonly GeoPoint[]): string {
  let output = '';
  let lastLat = 0;
  let lastLng = 0;
  const encode = (value: number) => {
    let rest = value < 0 ? ~(value << 1) : value << 1;
    while (rest >= 0x20) {
      output += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
      rest >>= 5;
    }
    output += String.fromCharCode(rest + 63);
  };
  for (const point of points) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);
    encode(lat - lastLat);
    encode(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return output;
}

/** The trail of a finished shift: accurate fixes, simplified and encoded, with its gaps. */
export function compactTrail(points: readonly TrailPoint[]): {
  polyline: string;
  pointCount: number;
  keptCount: number;
  gaps: { from: number; to: number }[];
} {
  const accurate = points
    .filter((point) => point.accuracy <= TRAIL_ACCURACY_M)
    .sort((a, b) => a.capturedAt - b.capturedAt);
  const kept = simplifyTrail(accurate);
  return {
    polyline: encodePolyline(kept),
    pointCount: points.length,
    keptCount: kept.length,
    gaps: trailGaps(accurate),
  };
}

/** What the tenant counts as a day present (spec 5.10). */
export type AttendanceRule =
  { rule: 'punch_is_present' } | { rule: 'hours'; fullDayHours: number; halfDayHours: number };

export const PHASE1_DAY_STATUSES = [
  'future',
  'not_employed',
  'present',
  'half_day',
  'absent',
] as const;
export type DayStatus = (typeof PHASE1_DAY_STATUSES)[number];

/**
 * BR-23 as far as shifts decide it (decision D47): after today, `future`; outside employment,
 * `not_employed`; a shift that day, or enough hours on duty under the hours rule, `present`;
 * half-day hours, `half_day`; otherwise `absent`. Leave, holidays, weekly offs and
 * regularisations join in phase 2.
 */
export function dayStatus(day: {
  date: string;
  today: string;
  joiningDate: string | null;
  exitDate: string | null;
  shifts: number;
  hours: number;
  rule: AttendanceRule;
}): { status: DayStatus; value: number } {
  if (day.date > day.today) return { status: 'future', value: 0 };
  if (
    (day.joiningDate && day.date < day.joiningDate) ||
    (day.exitDate && day.date > day.exitDate)
  ) {
    return { status: 'not_employed', value: 0 };
  }
  if (day.rule.rule === 'punch_is_present') {
    return day.shifts > 0 ? { status: 'present', value: 1 } : { status: 'absent', value: 0 };
  }
  if (day.hours >= day.rule.fullDayHours) return { status: 'present', value: 1 };
  if (day.hours >= day.rule.halfDayHours) return { status: 'half_day', value: 0.5 };
  return { status: 'absent', value: 0 };
}
