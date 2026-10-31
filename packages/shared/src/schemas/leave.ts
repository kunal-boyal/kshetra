import { z } from 'zod';
import { LEAVE_REASON_MAX } from '../leave';
import { ApprovalResult } from './approvals';
import { Key, LocalizedText } from './config';

/**
 * Leave (M13, spec 5.10, BR-27, decision D81): the tenant's leave types, people's requests through
 * the `leave` chain, and their balances in each type's quota year.
 */

const CalendarDate = z.iso.date();

/** A leave type as configuration holds it; templates use the same schema. */
export const LeaveType = z
  .strictObject({
    key: Key,
    name: LocalizedText,
    paid: z.boolean(),
    annualQuota: z.number().min(0).max(366).multipleOf(0.5).meta({
      description: 'Days per quota year; 0 means the type has no quota',
    }),
    quotaYear: z.enum(['calendar', 'financial']),
    halfDayAllowed: z.boolean(),
    attachmentAfterDays: z.int().min(1).max(366).optional().meta({
      description: 'Requests longer than this many days need an attachment',
    }),
    active: z.boolean().default(true),
    /** How the quota is credited (D114): all on the quota year's first day, or month by month. */
    accrual: z.enum(['yearly', 'monthly']).default('yearly'),
    carryForwardMax: z.number().min(0).max(366).multipleOf(0.5).default(0).meta({
      description: 'Unused days carried into the next quota year, at most; the rest lapses',
    }),
  })
  .meta({ id: 'LeaveType' });

/** `GET /v1/leave-types`. */
export const LeaveTypeListResult = z.object({ items: z.array(LeaveType) });

/**
 * `PUT /v1/leave-types`: the whole list. Types are never removed, as requests name them; switch
 * one off with `active: false`.
 */
export const LeaveTypesBody = z.strictObject({ items: z.array(LeaveType).max(30) });

export const LEAVE_STATES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const LeaveState = z.enum(LEAVE_STATES);

/** `POST /v1/leave-requests`, with the ID made where it was asked for. */
export const CreateLeaveRequestBody = z
  .strictObject({
    id: z.uuid(),
    leaveType: Key,
    startDate: CalendarDate,
    endDate: CalendarDate,
    halfDay: z.boolean().default(false),
    reason: z.string().trim().max(LEAVE_REASON_MAX).optional(),
    /** An `attachment` photo, such as a doctor's note, when the type asks for one. */
    attachmentId: z.uuid().optional(),
  })
  .meta({ id: 'CreateLeaveRequestBody' });

export const LeaveRequestResult = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    leaveType: Key,
    startDate: CalendarDate,
    endDate: CalendarDate,
    halfDay: z.boolean(),
    /** Working days, as BR-27 counted them when asked. */
    days: z.number(),
    reason: z.string().nullable(),
    attachmentId: z.uuid().nullable(),
    state: LeaveState,
    approval: ApprovalResult.nullable(),
    createdAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'LeaveRequest' });

export const LeaveRequestListQuery = z
  .strictObject({
    userId: z.uuid().optional(),
    /** Requests starting in this calendar year. */
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    /** Everyone the caller sees instead of one person, with `period` (decision D104). */
    team: z.stringbool().optional(),
    /** With `team`: requests that take in a day of this month. */
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-10')
      .optional(),
  })
  .superRefine((query, context) => {
    if (query.team && (!query.period || query.userId || query.year)) {
      context.addIssue({
        code: 'custom',
        path: ['team'],
        message: 'Ask for a team with a period, and without a person or year',
      });
    }
  });

export const LeaveRequestListResult = z.object({
  items: z.array(LeaveRequestResult),
  /** Whose requests these are. */
  people: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string() })),
});

export const LeaveBalanceQuery = z.strictObject({
  userId: z.uuid().optional(),
  /** The day whose quota years to read; today when left out. */
  on: CalendarDate.optional(),
});

export const LeaveBalance = z
  .object({
    leaveType: Key,
    from: CalendarDate,
    to: CalendarDate,
    /** Null for a type without a quota. */
    quota: z.number().nullable(),
    /** Credited by `on` (D114): the whole quota, or the months so far; null without a quota. */
    credited: z.number().nullable(),
    /** Carried in from the quota year before (D114). */
    carriedIn: z.number(),
    approved: z.number(),
    pending: z.number(),
    available: z.number().nullable(),
    /** Lapsed when the year ended (D114); 0 until then. */
    lapsed: z.number(),
  })
  .meta({ id: 'LeaveBalance' });

/** `GET /v1/leave-balances`: each active type's balance in the quota year of `on`. */
export const LeaveBalanceResult = z.object({
  userId: z.uuid(),
  on: CalendarDate,
  /** When the person joined, from which a monthly type credits (D114); null when not known. */
  joiningDate: CalendarDate.nullable(),
  items: z.array(LeaveBalance),
});

export type LeaveType = z.output<typeof LeaveType>;
export type LeaveTypesBody = z.output<typeof LeaveTypesBody>;
export type LeaveState = z.infer<typeof LeaveState>;
export type CreateLeaveRequestBody = z.output<typeof CreateLeaveRequestBody>;
export type LeaveRequestResult = z.infer<typeof LeaveRequestResult>;
export type LeaveRequestListQuery = z.output<typeof LeaveRequestListQuery>;
export type LeaveRequestListResult = z.infer<typeof LeaveRequestListResult>;
export type LeaveBalanceQuery = z.output<typeof LeaveBalanceQuery>;
export type LeaveBalance = z.infer<typeof LeaveBalance>;
export type LeaveBalanceResult = z.infer<typeof LeaveBalanceResult>;
