import { z } from 'zod';
import { distanceMeters, type GeoPoint } from './geo';

/**
 * Anomalies in evidence (BR-50, decision D119): what makes a reviewer look twice at a submission.
 * Each gives a flag and what it saw, never a refusal. Times are epoch milliseconds. The server
 * judges them at ingest; the web puts the notes in words.
 */

export const ANOMALY_FLAGS = [
  'photo_far',
  'fast_travel',
  'burst',
  'off_shift',
  'mock_history',
] as const;
export type AnomalyFlag = (typeof ANOMALY_FLAGS)[number];

/** A photo this much further from its record than both fixes' accuracies is far... */
export const PHOTO_FAR_M = 150;
/** ...each accuracy counting up to this much. */
export const PHOTO_FAR_ACCURACY_CAP_M = 100;
/** Two records closer in time than this speed allows, in a straight line, travelled too fast... */
export const FAST_TRAVEL_KMH = 100;
/** ...when at least this far apart, so GPS drift between near records never counts. */
export const FAST_TRAVEL_MIN_M = 5_000;
/** This many records within the window, at as many places, are a burst. */
export const BURST_COUNT = 3;
export const BURST_WINDOW_MS = 10 * 60_000;
/** Records without accounts are at different places when further apart than this. */
export const BURST_APART_M = 300;
/** A mocked fix the phone refused flags the person's records for this many days after. */
export const MOCK_HISTORY_DAYS = 30;
/** The phone's reports of mocked fixes are kept this long. */
export const MOCK_REPORT_KEEP_DAYS = 90;
/** Records this many hours either side of a capture are compared with it. */
export const ANOMALY_LOOK_HOURS = 12;

const DAY_MS = 86_400_000;

/** Where in the app the phone refused a mocked fix. */
export const MOCK_SOURCES = ['tracking', 'punch', 'visit', 'form', 'photo'] as const;
export type MockSource = (typeof MOCK_SOURCES)[number];

/** The kinds of record a submission is compared with. */
export const PLACED_KINDS = [
  'submission',
  'check_in',
  'check_out',
  'punch_in',
  'punch_out',
] as const;
export type PlacedKind = (typeof PLACED_KINDS)[number];

/** A moment the person was somewhere, as the server has it. */
export interface PlacedRecord {
  kind: PlacedKind;
  id: string;
  at: number;
  point: GeoPoint;
  accountId: string | null;
}

/** What each flag saw, for the reviewer's words. Never a place. */
export const FlagNotes = z
  .object({
    photo_far: z.object({ photoId: z.uuid(), distanceM: z.int() }),
    fast_travel: z.object({
      otherKind: z.enum(PLACED_KINDS),
      otherId: z.uuid(),
      otherAt: z.iso.datetime({ offset: true }),
      distanceM: z.int(),
      seconds: z.int(),
    }),
    burst: z.object({ places: z.int(), seconds: z.int() }),
    off_shift: z.object({}),
    mock_history: z.object({
      source: z.enum(MOCK_SOURCES),
      lastSeenAt: z.iso.datetime({ offset: true }).nullable(),
    }),
  })
  .partial()
  .meta({ id: 'FlagNotes' });
export type FlagNotes = z.infer<typeof FlagNotes>;

/**
 * The farthest of a record's photos taken more than 150 m from it beyond both fixes' accuracies
 * (each counting up to 100 m), or null. A photo without a place of its own isn't measured.
 */
export function photoFar(
  photos: readonly { id: string; point: GeoPoint | null; accuracy: number | null }[],
  record: { point: GeoPoint; accuracy: number },
): NonNullable<FlagNotes['photo_far']> | null {
  const allowance = (accuracy: number | null) =>
    Math.min(Math.max(0, accuracy ?? 0), PHOTO_FAR_ACCURACY_CAP_M);
  let far: NonNullable<FlagNotes['photo_far']> | null = null;
  for (const photo of photos) {
    if (!photo.point) continue;
    const distance = distanceMeters(photo.point, record.point);
    const beyond = distance - allowance(photo.accuracy) - allowance(record.accuracy);
    if (beyond > PHOTO_FAR_M && (!far || distance > far.distanceM)) {
      far = { photoId: photo.id, distanceM: Math.round(distance) };
    }
  }
  return far;
}

/** Whether two records are at least 5 km apart and closer in time than 100 km/h allows. */
function tooFast(a: PlacedRecord, b: PlacedRecord): { distanceM: number; ms: number } | null {
  const distanceM = distanceMeters(a.point, b.point);
  const ms = Math.abs(a.at - b.at);
  // km/h = (d / 1000) / (ms / 3_600_000) = d × 3600 / ms.
  if (distanceM >= FAST_TRAVEL_MIN_M && distanceM * 3_600 > FAST_TRAVEL_KMH * ms) {
    return { distanceM, ms };
  }
  return null;
}

/**
 * The records this one is too far from for the time between them (BR-50): each with the
 * distance and time, nearest in time first. The note names the nearest.
 */
export function fastTravel(
  record: PlacedRecord,
  others: readonly PlacedRecord[],
): { other: PlacedRecord; note: NonNullable<FlagNotes['fast_travel']> }[] {
  return others
    .filter((other) => other.id !== record.id)
    .flatMap((other) => {
      const found = tooFast(record, other);
      return found
        ? [
            {
              other,
              note: {
                otherKind: other.kind,
                otherId: other.id,
                otherAt: new Date(other.at).toISOString(),
                distanceM: Math.round(found.distanceM),
                seconds: Math.round(found.ms / 1000),
              },
            },
          ]
        : [];
    })
    .sort((a, b) => a.note.seconds - b.note.seconds);
}

/** Whether two records are at one place: one account, or where either has none, within 300 m. */
function samePlace(a: PlacedRecord, b: PlacedRecord): boolean {
  if (a.accountId !== null && b.accountId !== null) return a.accountId === b.accountId;
  return distanceMeters(a.point, b.point) <= BURST_APART_M;
}

/** How many places a set of records covers, counting a record as new when it is at none so far. */
function placesOf(records: readonly PlacedRecord[]): number {
  const places: PlacedRecord[] = [];
  for (const record of records) {
    if (!places.some((place) => samePlace(place, record))) places.push(record);
  }
  return places.length;
}

/**
 * A burst this record is part of (BR-50): three or more records within 10 minutes at three or
 * more places. The widest such window wins; its other records and the note, or null.
 */
export function burst(
  record: PlacedRecord,
  others: readonly PlacedRecord[],
): { members: PlacedRecord[]; note: NonNullable<FlagNotes['burst']> } | null {
  const near = [record, ...others.filter((other) => other.id !== record.id)]
    .filter((other) => Math.abs(other.at - record.at) <= BURST_WINDOW_MS)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  let best: { members: PlacedRecord[]; places: number; seconds: number } | null = null;
  for (const start of near) {
    if (start.at > record.at) break;
    const window = near.filter(
      (other) => other.at >= start.at && other.at <= start.at + BURST_WINDOW_MS,
    );
    if (window.length < BURST_COUNT || !window.includes(record)) continue;
    const places = placesOf(window);
    if (places < BURST_COUNT) continue;
    if (
      !best ||
      places > best.places ||
      (places === best.places && window.length > best.members.length)
    ) {
      const last = window[window.length - 1]!;
      best = { members: window, places, seconds: Math.round((last.at - start.at) / 1000) };
    }
  }
  if (!best) return null;
  return {
    members: best.members.filter((member) => member.id !== record.id),
    note: { places: best.places, seconds: best.seconds },
  };
}

/**
 * Mocked locations behind a record (BR-50): one of its photos with a mocked fix of its own, or a
 * mocked fix the person's phone refused in the 30 days before the capture. Null otherwise.
 */
export function mockHistory(
  capturedAt: number,
  lastReport: { seenAt: number; source: MockSource } | null,
  photos: readonly { mocked: boolean | null }[],
): NonNullable<FlagNotes['mock_history']> | null {
  if (photos.some((photo) => photo.mocked === true)) return { source: 'photo', lastSeenAt: null };
  if (
    lastReport &&
    lastReport.seenAt <= capturedAt &&
    capturedAt - lastReport.seenAt <= MOCK_HISTORY_DAYS * DAY_MS
  ) {
    return { source: lastReport.source, lastSeenAt: new Date(lastReport.seenAt).toISOString() };
  }
  return null;
}

/** Everything a new submission's anomalies need (BR-50). */
export interface AnomalyInput {
  record: PlacedRecord & { accuracy: number };
  /** The person's other records within 12 hours either side. */
  others: readonly PlacedRecord[];
  photos: readonly {
    id: string;
    point: GeoPoint | null;
    accuracy: number | null;
    mocked: boolean | null;
  }[];
  /** Whether the capture fell on one of the person's shifts. */
  onShift: boolean;
  /** The latest mocked fix the person's phone reported at or before the capture. */
  lastMockReport: { seenAt: number; source: MockSource } | null;
}

/**
 * The anomaly flags of a new submission and their notes, leaving out those the tenant switched
 * off; with the other records a pair or burst also flags.
 */
export function anomalyFlags(
  input: AnomalyInput,
  off: readonly AnomalyFlag[],
): {
  flags: AnomalyFlag[];
  notes: FlagNotes;
  fastWith: { other: PlacedRecord; note: NonNullable<FlagNotes['fast_travel']> }[];
  burstWith: PlacedRecord[];
} {
  const on = (flag: AnomalyFlag) => !off.includes(flag);
  const notes: FlagNotes = {};
  const far = on('photo_far') ? photoFar(input.photos, input.record) : null;
  if (far) notes.photo_far = far;
  const fast = on('fast_travel') ? fastTravel(input.record, input.others) : [];
  if (fast[0]) notes.fast_travel = fast[0].note;
  const together = on('burst') ? burst(input.record, input.others) : null;
  if (together) notes.burst = together.note;
  if (on('off_shift') && !input.onShift) notes.off_shift = {};
  const mocked = on('mock_history')
    ? mockHistory(input.record.at, input.lastMockReport, input.photos)
    : null;
  if (mocked) notes.mock_history = mocked;
  return {
    flags: ANOMALY_FLAGS.filter((flag) => notes[flag] !== undefined),
    notes,
    fastWith: fast,
    burstWith: together?.members ?? [],
  };
}
