import { z } from 'zod';
import { REGULARISATION_REASON } from '../attendance';
import { ApprovalResult } from './approvals';
import { Key, LocalizedText } from './config';

/**
 * Holiday calendars and regularisation (M13, spec 5.10, decision D80): each person belongs to a
 * calendar of weekly offs and dated holidays, and asks to fix a past day through its chain.
 */

const CalendarDate = z.iso.date();

export const Holiday = z
  .object({ date: CalendarDate, name: z.string(), optional: z.boolean() })
  .meta({ id: 'Holiday' });

export const CalendarResult = z
  .object({
    key: Key,
    name: LocalizedText,
    /** ISO weekdays: 1 is Monday, 7 is Sunday. */
    weeklyOffs: z.array(z.int().min(1).max(7)),
    /** The calendar people belong to when none is chosen for them. */
    default: z.boolean(),
    holidays: z.array(Holiday),
  })
  .meta({ id: 'Calendar' });

export const CalendarListQuery = z.strictObject({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

/** `GET /v1/calendars`: every calendar with its holidays of a year. */
export const CalendarListResult = z.object({
  year: z.int(),
  items: z.array(CalendarResult),
});

export const CalendarParams = z.strictObject({ key: Key });

/**
 * `PUT /v1/calendars/{key}/holidays/{date}`: adds or renames a holiday; `active: false` takes it
 * off the calendar.
 */
export const HolidayBody = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    optional: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .meta({ id: 'HolidayBody' });

export const HolidayParams = z.strictObject({ key: Key, date: CalendarDate });

/** `PUT /v1/users/{id}/calendar`: the calendar a person keeps; null keeps the default. */
export const UserCalendarBody = z
  .strictObject({ calendarKey: Key.nullable() })
  .meta({ id: 'UserCalendarBody' });

export const UserCalendarResult = z.object({ userId: z.uuid(), calendarKey: Key.nullable() });

export const REGULARISATION_STATES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

/** `POST /v1/regularisations`: asks to count a past day as present or half (BR-28). */
export const CreateRegularisationBody = z
  .strictObject({
    id: z.uuid(),
    date: CalendarDate,
    status: z.enum(['present', 'half_day']),
    reason: z.string().trim().min(REGULARISATION_REASON.min).max(REGULARISATION_REASON.max),
  })
  .meta({ id: 'CreateRegularisationBody' });

export const RegularisationResult = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    date: CalendarDate,
    status: z.enum(['present', 'half_day']),
    reason: z.string(),
    state: z.enum(REGULARISATION_STATES),
    approval: ApprovalResult.nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Regularisation' });

export const RegularisationListQuery = z.strictObject({
  userId: z.uuid().optional(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-10'),
});

export const RegularisationListResult = z.object({ items: z.array(RegularisationResult) });

export type Holiday = z.infer<typeof Holiday>;
export type UserCalendarBody = z.output<typeof UserCalendarBody>;
export type CalendarResult = z.infer<typeof CalendarResult>;
export type CalendarListQuery = z.output<typeof CalendarListQuery>;
export type CalendarListResult = z.infer<typeof CalendarListResult>;
export type HolidayBody = z.output<typeof HolidayBody>;
export type CreateRegularisationBody = z.output<typeof CreateRegularisationBody>;
export type RegularisationResult = z.infer<typeof RegularisationResult>;
export type RegularisationListQuery = z.output<typeof RegularisationListQuery>;
export type RegularisationListResult = z.infer<typeof RegularisationListResult>;
