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

export const LeaveRequestListQuery = z.strictObject({
  userId: z.uuid().optional(),
  /** Requests starting in this calendar year. */
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const LeaveRequestListResult = z.object({ items: z.array(LeaveRequestResult) });

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
    approved: z.number(),
    pending: z.number(),
    available: z.number().nullable(),
  })
  .meta({ id: 'LeaveBalance' });

/** `GET /v1/leave-balances`: each active type's balance in the quota year of `on`. */
export const LeaveBalanceResult = z.object({
  userId: z.uuid(),
  on: CalendarDate,
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
