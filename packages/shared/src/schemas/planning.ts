import { z } from 'zod';
import { PLAN_ITEM_STATUSES } from '../planning';

/** A month, `YYYY-MM`. */
export const Period = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-10')
  .meta({ id: 'Period' });

const Weekday = z.int().min(1).max(7);

/** How often a route comes round (M8). Weekdays are ISO: 1 is Monday, 7 is Sunday. */
export const RouteRecurrence = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('weekdays'), days: z.array(Weekday).min(1).max(7) }),
    z.strictObject({
      kind: z.literal('weeks_of_month'),
      weeks: z.array(z.int().min(1).max(5)).min(1).max(5),
      days: z.array(Weekday).min(1).max(7),
    }),
    z.strictObject({
      kind: z.literal('every_n_days'),
      every: z.int().min(1).max(60),
      from: z.iso.date(),
    }),
  ])
  .meta({ id: 'RouteRecurrence' });

const RouteName = z.string().trim().min(1).max(100);

/** `POST /v1/routes`: a named, ordered list of accounts a person visits on a recurrence. */
export const CreateRouteBody = z.strictObject({
  id: z.uuid(),
  userId: z.uuid(),
  name: RouteName,
  recurrence: RouteRecurrence,
  accountIds: z.array(z.uuid()).min(1).max(100),
});

/** `PATCH /v1/routes/{id}`: send only what changes; the accounts, if sent, replace the list. */
export const UpdateRouteBody = z
  .strictObject({
    name: RouteName.optional(),
    recurrence: RouteRecurrence.optional(),
    accountIds: z.array(z.uuid()).min(1).max(100).optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Send something to change' });

export const RouteResult = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    name: z.string(),
    recurrence: RouteRecurrence,
    accounts: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string() })),
    active: z.boolean(),
  })
  .meta({ id: 'RouteResult' });

export const RouteListQuery = z.strictObject({ userId: z.uuid() });
export const RouteListResult = z.object({ items: z.array(RouteResult) });

/** `POST /v1/plans/generate`: makes a person's plan items for a month from their routes. */
export const GeneratePlanBody = z.strictObject({ userId: z.uuid(), period: Period });
export const GeneratePlanResult = z.object({
  /** Items made now; those made by an earlier run are left as they are. */
  created: z.int(),
  /** Accounts on a route that the person no longer sees, left out. */
  skippedAccounts: z.array(z.uuid()),
});

export const PlanItemStatus = z.enum(PLAN_ITEM_STATUSES);

/** `POST /v1/plan-items`: a visit planned by hand (M8), with its own ID. */
export const CreatePlanItemBody = z.strictObject({
  id: z.uuid(),
  userId: z.uuid(),
  accountId: z.uuid(),
  date: z.iso.date(),
  purpose: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
});

export const PlanItemResult = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    account: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    date: z.iso.date(),
    purpose: z.string().nullable(),
    note: z.string().nullable(),
    status: PlanItemStatus,
    source: z.enum(['route', 'adhoc']),
    routeId: z.uuid().nullable(),
    visitId: z.uuid().nullable(),
  })
  .meta({ id: 'PlanItemResult' });

/** `GET /v1/plan-items`: a person's plan for a month, by date. */
export const PlanItemListQuery = z.strictObject({ userId: z.uuid(), period: Period });

export const PLAN_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;

export const PlanItemListResult = z.object({
  items: z.array(PlanItemResult),
  /** The month's approval, when the tenant asks for plans to be approved; null otherwise. */
  approval: z.object({ status: z.enum(PLAN_STATUSES), approvalId: z.uuid().nullable() }).nullable(),
});

/** `POST /v1/plans/submit`: asks the person's manager to approve their month's plan. */
export const SubmitPlanBody = z.strictObject({ userId: z.uuid(), period: Period });
export const SubmitPlanResult = z.object({
  status: z.enum(PLAN_STATUSES),
  approvalId: z.uuid().nullable(),
});

export type Period = z.output<typeof Period>;
export type PlanItemStatus = z.output<typeof PlanItemStatus>;
export type RouteRecurrence = z.output<typeof RouteRecurrence>;
export type CreateRouteBody = z.output<typeof CreateRouteBody>;
export type UpdateRouteBody = z.output<typeof UpdateRouteBody>;
export type RouteResult = z.output<typeof RouteResult>;
export type RouteListQuery = z.output<typeof RouteListQuery>;
export type RouteListResult = z.output<typeof RouteListResult>;
export type GeneratePlanBody = z.output<typeof GeneratePlanBody>;
export type GeneratePlanResult = z.output<typeof GeneratePlanResult>;
export type CreatePlanItemBody = z.output<typeof CreatePlanItemBody>;
export type PlanItemResult = z.output<typeof PlanItemResult>;
export type PlanItemListQuery = z.output<typeof PlanItemListQuery>;
export type PlanItemListResult = z.output<typeof PlanItemListResult>;
export type SubmitPlanBody = z.output<typeof SubmitPlanBody>;
export type SubmitPlanResult = z.output<typeof SubmitPlanResult>;
