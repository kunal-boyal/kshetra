import { z } from 'zod';
import {
  EXPENSE_CALCULATIONS,
  EXPENSE_CATEGORIES,
  EXPENSE_DESCRIPTION,
  KM_SOURCES,
} from '../expenses';
import { ApprovalResult } from './approvals';
import { Key, LocalizedText, Money } from './config';
import { OdometerReading } from './field';

/**
 * Expenses (M12, spec 5.10, BR-29, BR-30, decision D83): the tenant's policies as versions, and
 * people's claims against them through the `expense` chain, until back office marks them paid.
 */

const CalendarDate = z.iso.date();

/** A flat rate, or a rate for each designation. */
export const ExpenseRate = z
  .union([z.strictObject({ flat: Money }), z.strictObject({ byDesignation: z.record(Key, Money) })])
  .meta({ id: 'ExpenseRate' });

/** How a claim's amount is calculated and capped (spec 5.10, BR-29); templates use it too. */
export const ExpensePolicy = z
  .strictObject({
    key: Key,
    name: LocalizedText,
    category: z.enum(EXPENSE_CATEGORIES),
    calculation: z.enum(EXPENSE_CALCULATIONS),
    kmFrom: z.enum(KM_SOURCES).optional().meta({
      description:
        "Per-km policies: `odometer` readings (when left out) or the day's `tracked` distance (decision D115).",
    }),
    rate: ExpenseRate.optional().meta({
      description: 'Per km, day or visit. Leave out when the claim is the bill amount (actual).',
    }),
    caps: z
      .strictObject({
        perClaim: Money.optional(),
        perDay: Money.optional(),
        perMonth: Money.optional(),
      })
      .default({}),
    receiptRequired: z.boolean().default(false),
    odometerPhotosRequired: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .meta({ id: 'ExpensePolicy' });

/** A policy as it stands, with the version in force and the day it took effect. */
export const ExpensePolicyResult = ExpensePolicy.extend({
  version: z.int().min(1),
  validFrom: CalendarDate,
}).meta({ id: 'ExpensePolicyResult' });

/** `GET /v1/expense-policies`. */
export const ExpensePolicyListResult = z.object({ items: z.array(ExpensePolicyResult) });

/**
 * `PUT /v1/expense-policies`: the whole list. A changed policy gets a new version from `from`
 * (today when left out); claims keep the version in force on their day. Policies are never
 * removed, as claims name them; switch one off with `active: false`.
 */
export const ExpensePoliciesBody = z.strictObject({
  items: z.array(ExpensePolicy).max(30),
  from: CalendarDate.optional(),
});

/** Odometer readings, to a tenth of a kilometre. */
const Reading = OdometerReading;

/** Days, whole or half. */
const Days = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,2})(?:\.[05])?$/, 'Write whole or half days, such as 2 or 1.5');

export const EXPENSE_STATES = ['pending', 'approved', 'rejected', 'cancelled', 'paid'] as const;
export const ExpenseState = z.enum(EXPENSE_STATES);

/** `POST /v1/expense-claims`, with the ID made where it was claimed. */
export const CreateExpenseClaimBody = z
  .strictObject({
    id: z.uuid(),
    policy: Key,
    expenseDate: CalendarDate,
    description: z.string().trim().min(EXPENSE_DESCRIPTION.min).max(EXPENSE_DESCRIPTION.max),
    /** Per-day policies. */
    days: Days.optional(),
    /** Per-km policies; optional where the policy pays tracked distance (D115). */
    odometerOpen: Reading.optional(),
    odometerClose: Reading.optional(),
    /** Actual policies: the bill. */
    billAmount: Money.optional(),
    /** `receipt` photos; more can follow while the claim waits. */
    receiptIds: z.array(z.uuid()).max(10).default([]),
    /** `odometer` photos, opening and closing. */
    odometerPhotoIds: z.array(z.uuid()).max(4).default([]),
    /**
     * Per-km policies: the person's shift whose punch readings and photos the claim begins from
     * (decision D99). Readings left out take the shift's; a reading changed from it is flagged.
     */
    shiftId: z.uuid().optional(),
  })
  .meta({ id: 'CreateExpenseClaimBody' });

export const ExpenseClaimResult = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    user: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    policy: Key,
    policyVersion: z.int(),
    expenseDate: CalendarDate,
    description: z.string(),
    /** Kilometres, days or visits; null for a bill. */
    quantity: z.string().nullable(),
    rate: Money.nullable(),
    odometerOpen: z.string().nullable(),
    odometerClose: z.string().nullable(),
    /**
     * Per-km claims: the day's tracked kilometres when the claim was made, from the person's
     * ended shifts; null without one (decision D115).
     */
    trackedKm: z.string().nullable(),
    billAmount: Money.nullable(),
    /** Before caps. */
    calculated: Money,
    /** What is claimed, after caps (BR-29). */
    amount: Money,
    capped: z.boolean(),
    receipts: z.array(z.uuid()),
    /** The claim's own odometer photos, or its shift's punch photos (decision D99). */
    odometerPhotos: z.array(z.uuid()),
    /** The shift the claim's readings began from, if any. */
    shiftId: z.uuid().nullable(),
    /**
     * What reviewers should look at, such as `duplicate_receipt`, `receipt_missing`,
     * `odometer_changed` when a reading differs from its shift's (D99), or `distance_gap` when
     * the odometer and tracked kilometres differ by more than the tolerance (D115).
     */
    flags: z.array(z.string()),
    state: ExpenseState,
    approval: ApprovalResult.nullable(),
    paidAt: z.iso.datetime().nullable(),
    paymentReference: z.string().nullable(),
    createdAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'ExpenseClaim' });

export const ExpenseClaimListQuery = z.strictObject({
  userId: z.uuid().optional(),
  /** Claims for days in this month. */
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-10')
    .optional(),
  state: ExpenseState.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ExpenseClaimListResult = z.object({
  items: z.array(ExpenseClaimResult),
  nextCursor: z.string().nullable(),
  /**
   * The month's totals under the filters but `state`, on the first page only (decision D104):
   * every claim but cancelled ones, those waiting for a decision, what the caps cut (BR-29), and
   * those approved and not yet paid.
   */
  summary: z
    .object({
      claimed: Money,
      claims: z.int().min(0),
      waiting: Money,
      waitingClaims: z.int().min(0),
      overPolicy: Money,
      approved: Money,
      approvedClaims: z.int().min(0),
    })
    .nullable(),
});

/** `POST /v1/expense-claims/{id}/receipts`: more receipt photos while the claim waits. */
export const AddReceiptsBody = z
  .strictObject({ mediaIds: z.array(z.uuid()).min(1).max(10) })
  .meta({ id: 'AddReceiptsBody' });

/** `POST /v1/expense-claims/{id}/paid`: back office has paid an approved claim. */
export const MarkPaidBody = z
  .strictObject({ reference: z.string().trim().max(80).optional() })
  .meta({ id: 'MarkPaidBody' });

export type ExpensePolicy = z.output<typeof ExpensePolicy>;
export type ExpensePolicyResult = z.output<typeof ExpensePolicyResult>;
export type ExpensePoliciesBody = z.output<typeof ExpensePoliciesBody>;
export type ExpenseState = z.infer<typeof ExpenseState>;
export type CreateExpenseClaimBody = z.output<typeof CreateExpenseClaimBody>;
export type ExpenseClaimResult = z.infer<typeof ExpenseClaimResult>;
export type ExpenseClaimListQuery = z.output<typeof ExpenseClaimListQuery>;
export type ExpenseClaimListResult = z.infer<typeof ExpenseClaimListResult>;
export type AddReceiptsBody = z.output<typeof AddReceiptsBody>;
export type MarkPaidBody = z.output<typeof MarkPaidBody>;
