import { z } from 'zod';
import { STATUTORY_STATES } from '../statutory';
import { Key } from './config';
import { Period } from './planning';

/**
 * Statutory payroll (M14, BR-56 to BR-58, decision D128): the rates in force from a date, kept by
 * the vendor as dated configuration, never in code; a payslip keeps the set it was worked out on.
 */

const Amount = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/, 'Write an amount such as 15000');
const Rate = z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/, 'Write a percentage such as 12');

/** A professional tax slab: from this monthly (or yearly) amount, so much a month. */
const PtSlab = z.strictObject({
  from: Amount,
  amount: Amount,
  /** Taken in February instead, as Maharashtra and Karnataka do. */
  february: Amount.optional(),
  /** Taken in March instead, the year's last month, as Madhya Pradesh does. */
  march: Amount.optional(),
});

export const StatutoryState = z.enum(STATUTORY_STATES);

export const StatutoryRates = z
  .strictObject({
    pf: z.strictObject({
      employeePercent: Rate,
      /** The employer's 12% splits into EPS on the ceiling and EPF for the rest. */
      employerPercent: Rate,
      epsPercent: Rate,
      edliPercent: Rate,
      adminPercent: Rate,
      wageCeiling: Amount,
    }),
    esi: z.strictObject({
      employeePercent: Rate,
      employerPercent: Rate,
      /** Covered when wages at a contribution period's start are this or less. */
      wageLimit: Amount,
      /** At or below this average daily wage the employee pays nothing; the employer still does. */
      exemptDailyWage: Amount,
    }),
    pt: z.partialRecord(
      StatutoryState,
      z.strictObject({
        /** `monthly` slabs read the month's gross; `annual` ones the year's, spread by month. */
        basis: z.enum(['monthly', 'annual']),
        slabs: z.array(PtSlab).max(12),
        /** Slabs for women where the state sets its own, as Maharashtra does. */
        women: z.array(PtSlab).max(12).optional(),
      }),
    ),
    lwf: z.partialRecord(
      StatutoryState,
      z.strictObject({
        /** The months the fund is taken in, 1 to 12. */
        months: z.array(z.int().min(1).max(12)).min(1).max(12),
        employee: Amount,
        employer: Amount,
      }),
    ),
    tds: z.strictObject({
      /** New regime only (D128). */
      standardDeduction: Amount,
      slabs: z
        .array(z.strictObject({ from: Amount, percent: Rate }))
        .min(1)
        .max(12),
      rebateLimit: Amount,
      rebateMax: Amount,
      cessPercent: Rate,
      /** Above this income a surcharge is due; v1 flags it for the accountant. */
      surchargeFrom: Amount,
    }),
  })
  .meta({ id: 'StatutoryRates' });

export const StatutoryRateSet = z
  .strictObject({
    id: z.string().min(1).max(40),
    /** In force from this date; a month takes the set in force on its last day. */
    from: z.iso.date(),
    rates: StatutoryRates,
    /** What the set rests on, for the reviewer: each source and anything still to confirm. */
    notes: z.string().max(4000).default(''),
  })
  .meta({ id: 'StatutoryRateSet' });

export type StatutoryRatesValue = z.output<typeof StatutoryRates>;
export type StatutoryRateSet = z.output<typeof StatutoryRateSet>;

// The cell's requests and answers (D128).

const Person = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

/** `PUT /v1/salary-structures/{userId}`: a structure from a month, this month when left out. */
export const SalaryStructureBody = z
  .strictObject({
    from: Period.optional(),
    basic: Amount,
    da: Amount.default('0'),
    hra: Amount.default('0'),
    conveyance: Amount.default('0'),
    special: Amount.default('0'),
    others: z
      .array(z.strictObject({ key: Key, amount: Amount, excluded: z.boolean() }))
      .max(10)
      .refine(
        (list) => new Set(list.map((entry) => entry.key)).size === list.length,
        'Name each allowance once',
      )
      .default([]),
  })
  .meta({ id: 'SalaryStructureBody' });

const StructureView = z.object({
  basic: z.string(),
  da: z.string(),
  hra: z.string(),
  conveyance: z.string(),
  special: z.string(),
  others: z.array(z.object({ key: z.string(), amount: z.string(), excluded: z.boolean() })),
});

export const SalaryStructureResult = z
  .object({
    userId: z.uuid(),
    /** Each change with the month it applies from, and its wages under the codes (BR-56). */
    changes: z.array(StructureView.extend({ from: Period, wages: z.string(), gross: z.string() })),
  })
  .meta({ id: 'SalaryStructureResult' });

/** `PUT /v1/statutory-profiles/{userId}`. The PAN is never sent; only whether it is on file. */
export const StatutoryProfileBody = z
  .strictObject({
    workState: StatutoryState.nullable(),
    ptWomen: z.boolean().default(false),
    pfMember: z.boolean().default(true),
    pfFullWage: z.boolean().default(false),
    uan: z
      .string()
      .regex(/^\d{12}$/, 'A UAN has 12 digits')
      .nullable()
      .default(null),
    esiNumber: z
      .string()
      .regex(/^\d{10}$/, 'An ESI number has 10 digits')
      .nullable()
      .default(null),
    panOnFile: z.boolean().default(false),
  })
  .meta({ id: 'StatutoryProfileBody' });

export const StatutoryProfileResult = StatutoryProfileBody.extend({ userId: z.uuid() }).meta({
  id: 'StatutoryProfileResult',
});

export const PayRunBody = z.strictObject({ period: Period }).meta({ id: 'PayRunBody' });
export const PayRunParams = z.strictObject({ period: Period });
export const PayRunApproveBody = z
  .strictObject({ version: z.int().min(1) })
  .meta({ id: 'PayRunApproveBody' });

/** `POST /v1/pay-adjustments`: an earning or deduction for a person in a month's run. */
export const PayAdjustmentBody = z
  .strictObject({
    id: z.uuid(),
    userId: z.uuid(),
    period: Period,
    kind: z.enum(['earning', 'deduction']),
    key: Key,
    amount: Amount,
    note: z.string().trim().min(1).max(200),
  })
  .meta({ id: 'PayAdjustmentBody' });

const Line = z.object({ key: z.string(), amount: z.string() });

/** One person's payslip as a run holds it (BR-56 to BR-58). */
export const StatutoryPayslip = z
  .object({
    user: Person,
    period: Period,
    status: z.enum(['draft', 'approved']),
    profile: StatutoryProfileBody,
    structure: StructureView,
    scheduled: z.int(),
    paid: z.number(),
    esiCovered: z.boolean(),
    wages: z.string(),
    earnings: z.array(Line),
    deductions: z.array(Line),
    employer: z.array(Line),
    gross: z.string(),
    totalDeductions: z.string(),
    net: z.string(),
    flags: z.array(z.string()),
    rateSetId: z.string(),
    /** False until a chartered accountant has reviewed the rules and this rate set. */
    reviewed: z.boolean(),
  })
  .meta({ id: 'StatutoryPayslip' });

export const PayRunResult = z
  .object({
    id: z.uuid(),
    period: Period,
    status: z.enum(['draft', 'approved']),
    version: z.int(),
    rateSet: z.object({ id: z.string(), from: z.iso.date() }),
    reviewed: z.boolean(),
    approvedAt: z.iso.datetime().nullable(),
    approvedBy: Person.nullable(),
    totals: z.object({
      gross: z.string(),
      deductions: z.string(),
      net: z.string(),
      employer: z.string(),
    }),
    payslips: z.array(
      z.object({
        user: Person,
        gross: z.string(),
        totalDeductions: z.string(),
        net: z.string(),
        flags: z.array(z.string()),
      }),
    ),
  })
  .meta({ id: 'PayRunResult' });

export const StatutoryPayslipParams = z.strictObject({ userId: z.uuid(), period: Period });

export type SalaryStructureBody = z.output<typeof SalaryStructureBody>;
export type SalaryStructureResult = z.infer<typeof SalaryStructureResult>;
export type StatutoryProfileBody = z.output<typeof StatutoryProfileBody>;
export type StatutoryProfileResult = z.infer<typeof StatutoryProfileResult>;
export type PayAdjustmentBody = z.output<typeof PayAdjustmentBody>;
export type StatutoryPayslip = z.infer<typeof StatutoryPayslip>;
export type PayRunResult = z.infer<typeof PayRunResult>;
