import { z } from 'zod';
import { GeoPoint } from '../geo';
import { PHASE1_DAY_STATUSES, POINT_REJECTIONS } from '../tracking';

/**
 * Shifts and location tracking (M5, spec 11.2, 12.1). Records made on the phone carry their own
 * IDs and capture times, so a resend replays and the server judges each by when it happened.
 */

const When = z.iso.datetime({ offset: true });
const CalendarDate = z.iso.date();
const Accuracy = z
  .number()
  .min(0)
  .max(100_000)
  .meta({ description: 'Metres, as the phone reports' });

/** A fix the phone took for a punch: where, how accurate, and whether it was mocked. */
export const PunchFix = z.strictObject({
  location: GeoPoint,
  accuracy: Accuracy,
  mocked: z.boolean().meta({ description: 'Whether the operating system says the fix is mocked' }),
});

/** `POST /v1/shifts`: punch in (M5). Replaying the same ID returns the shift as it is. */
export const StartShiftBody = PunchFix.extend({
  id: z.uuid(),
  startedAt: When,
  consentVersion: z.string().trim().min(1).max(40).meta({
    description: 'The version of the consent text the person accepted for this shift',
  }),
  selfieMediaId: z.uuid().optional().meta({ description: 'When the tenant asks for a selfie' }),
});

/** `POST /v1/shifts/{id}/end`: punch out. Ending an ended shift returns it as it is. */
export const EndShiftBody = PunchFix.extend({ endedAt: When });

/** `POST /v1/shifts/{id}/pauses`: tracking stops, attendance doesn't (M5). */
export const PauseShiftBody = z.strictObject({
  id: z.uuid(),
  pausedAt: When,
  reason: z.string().trim().min(1).max(200),
});

export const PauseParams = z.strictObject({ id: z.uuid(), pauseId: z.uuid() });

/** `POST /v1/shifts/{id}/pauses/{pauseId}/resume`: tracking starts again. */
export const ResumeShiftBody = z.strictObject({ resumedAt: When });

export const SHIFT_END_REASONS = ['punch_out', 'auto_closed', 'max_length', 'admin'] as const;
export const ShiftEndReason = z.enum(SHIFT_END_REASONS);

export const ShiftPauseResult = z.object({
  id: z.uuid(),
  pausedAt: z.iso.datetime(),
  resumedAt: z.iso.datetime().nullable(),
  reason: z.string(),
});

export const ShiftResult = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    startedAt: z.iso.datetime(),
    startLocation: GeoPoint,
    startAccuracy: z.number(),
    consentVersion: z.string(),
    selfieMediaId: z.uuid().nullable(),
    endedAt: z.iso.datetime().nullable(),
    endLocation: GeoPoint.nullable(),
    endAccuracy: z.number().nullable(),
    endReason: ShiftEndReason.nullable(),
    /** From accurate fixes once the trail is compacted; null until then. */
    distanceM: z.int().nullable(),
    /** Time on duty less pauses, once the shift has ended. */
    onDutySeconds: z.int().nullable(),
    pauses: z.array(ShiftPauseResult),
    /** For reviewers: `clock_skew` when the phone's clock was over 10 minutes out (BR-44). */
    flags: z.array(z.enum(['clock_skew'])),
  })
  .meta({ id: 'ShiftResult' });

/** `GET /v1/shifts/current`: the caller's open shift, so a phone can pick up where it was. */
export const CurrentShiftResult = z.object({ shift: ShiftResult.nullable() });

/** `GET /v1/shifts`: a person's shifts, newest first, a page at a time. */
export const ShiftListQuery = z.strictObject({
  userId: z.uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
});

export const ShiftListResult = z.object({
  items: z.array(ShiftResult),
  nextCursor: z.string().nullable(),
});

export const LOCATION_SOURCES = ['foreground', 'background'] as const;

/** One point the phone recorded on a shift (spec 12.1). */
export const LocationPointBody = z.strictObject({
  id: z.uuid(),
  shiftId: z.uuid(),
  capturedAt: When,
  location: GeoPoint,
  accuracy: Accuracy,
  speed: z.number().min(0).max(200).nullable().optional().meta({ description: 'Metres a second' }),
  mocked: z.boolean(),
  source: z.enum(LOCATION_SOURCES),
  battery: z.int().min(0).max(100).nullable().optional().meta({ description: 'Percent' }),
});

/** `POST /v1/locations/batch`: up to 200 points, each accepted or refused on its own (BR-36). */
export const LocationBatchBody = z.strictObject({
  points: z.array(LocationPointBody).min(1).max(200),
});

export const PointRejection = z.enum(POINT_REJECTIONS);

/** Both lists are final: the phone drops every point named in either (spec 12.1). */
export const LocationBatchResult = z.object({
  accepted: z.array(z.uuid()),
  rejected: z.array(z.object({ id: z.uuid(), reason: PointRejection })),
});

export const DayStatus = z.enum(PHASE1_DAY_STATUSES);

/** One day of a person's attendance (BR-23 as shifts decide it in phase 1, decision D47). */
export const AttendanceDayResult = z.object({
  date: CalendarDate,
  status: DayStatus,
  value: z.number(),
  firstIn: z.iso.datetime().nullable(),
  lastOut: z.iso.datetime().nullable(),
  hours: z.number(),
});

/** `GET /v1/attendance`: a person's days in a month. */
export const AttendanceQuery = z.strictObject({
  userId: z.uuid(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-10'),
});

export const AttendanceResult = z.object({
  userId: z.uuid(),
  period: z.string(),
  days: z.array(AttendanceDayResult),
});

export type PunchFix = z.output<typeof PunchFix>;
export type StartShiftBody = z.output<typeof StartShiftBody>;
export type EndShiftBody = z.output<typeof EndShiftBody>;
export type PauseShiftBody = z.output<typeof PauseShiftBody>;
export type ResumeShiftBody = z.output<typeof ResumeShiftBody>;
export type ShiftEndReason = z.output<typeof ShiftEndReason>;
export type ShiftResult = z.output<typeof ShiftResult>;
export type CurrentShiftResult = z.output<typeof CurrentShiftResult>;
export type ShiftListQuery = z.output<typeof ShiftListQuery>;
export type ShiftListResult = z.output<typeof ShiftListResult>;
export type LocationPointBody = z.output<typeof LocationPointBody>;
export type LocationBatchBody = z.output<typeof LocationBatchBody>;
export type LocationBatchResult = z.output<typeof LocationBatchResult>;
export type AttendanceDayResult = z.output<typeof AttendanceDayResult>;
export type AttendanceQuery = z.output<typeof AttendanceQuery>;
export type AttendanceResult = z.output<typeof AttendanceResult>;
