import { z } from 'zod';
import { Money } from './config';
import { DayStatus } from './field';
import { Period } from './planning';

/**
 * Payroll inputs (M14, BR-26, decisions D14 and D117): each person's monthly gross from a month,
 * and the provisional pay attendance earns. An attendance-based estimate, never statutory payroll.
 */

const Person = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  designation: z.string(),
});

/** `PUT /v1/payroll-gross/{userId}`: a person's monthly gross from a month, this month when left out. */
export const PayrollGrossBody = z
  .strictObject({ monthlyGross: Money, from: Period.optional() })
  .meta({ id: 'PayrollGrossBody' });

export const PayrollGrossResult = z
  .object({
    userId: z.uuid(),
    /** Every change, earliest first. */
    changes: z.array(z.object({ from: Period, monthlyGross: Money })),
  })
  .meta({ id: 'PayrollGrossResult' });

/** A person's month: what attendance earns against their gross (BR-26). */
export const PayrollMonth = z
  .object({
    user: Person,
    period: Period,
    /** The gross in force that month; null when none has been entered. */
    monthlyGross: Money.nullable(),
    /** The month's working days on the person's calendar (D117). */
    scheduled: z.number(),
    /** Paid days so far (BR-25). */
    paid: z.number(),
    /** Provisional pay; null without a gross. */
    amount: Money.nullable(),
    /** The month is still running: the amount is earned so far. */
    toDate: z.boolean(),
  })
  .meta({ id: 'PayrollMonth' });

/** `GET /v1/payroll`: everyone the caller reaches, for a month. */
export const PayrollQuery = z.strictObject({
  period: Period,
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const PayrollListResult = z.object({
  items: z.array(PayrollMonth),
  nextCursor: z.string().nullable(),
});

/** `GET /v1/payslips/{userId}/{period}`: the payslip preview, with the month's days by status. */
export const PayslipResult = PayrollMonth.extend({
  days: z.record(DayStatus, z.int().min(0)),
}).meta({ id: 'Payslip' });

export const PayslipParams = z.strictObject({ userId: z.uuid(), period: Period });

/** The person a gross belongs to. */
export const PayrollUserParams = z.strictObject({ userId: z.uuid() });

export type PayrollGrossBody = z.output<typeof PayrollGrossBody>;
export type PayrollGrossResult = z.output<typeof PayrollGrossResult>;
export type PayrollMonth = z.output<typeof PayrollMonth>;
export type PayrollQuery = z.output<typeof PayrollQuery>;
export type PayrollListResult = z.output<typeof PayrollListResult>;
export type PayslipResult = z.output<typeof PayslipResult>;
