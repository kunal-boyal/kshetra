import { z } from 'zod';
import { METRIC_UNITS } from '../targets';
import { Key, LocalizedNoun } from './config';
import { Period, TargetPeriod } from './planning';

/** A metric as the targets and plans screens need it (spec 5.7). */
export const MetricView = z
  .object({
    key: Key,
    name: LocalizedNoun,
    unit: z.enum(METRIC_UNITS),
    direction: z.enum(['higher_is_better', 'lower_is_better']),
    targetable: z.boolean(),
  })
  .meta({ id: 'MetricView' });

export const MetricListResult = z.object({ items: z.array(MetricView) });

/** A value for a metric: a decimal number as text, never binary floating point (spec 10.1). */
export const TargetValue = z.string().trim().min(1).max(20);

/** Values by metric key; `null` clears one, and a key left out stays as it was. */
export const TargetValues = z.record(Key, TargetValue.nullable());

export const TARGET_STATUSES = ['none', 'draft', 'locked'] as const;

/** One person's targets for a month (spec 5.8). `version` is 0 before the set exists. */
export const TargetSetResult = z
  .object({
    user: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    period: TargetPeriod,
    status: z.enum(TARGET_STATUSES),
    values: z.record(Key, z.string()),
    lockedAt: z.iso.datetime().nullable(),
    lockedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    version: z.int().min(0),
  })
  .meta({ id: 'TargetSetResult' });

/** `GET /v1/targets`: the month's targets of the people in the caller's scope. */
export const TargetListQuery = z.strictObject({ period: TargetPeriod });

export const TargetListResult = z.object({
  period: TargetPeriod,
  /** The targetable metrics, as the grid's columns. */
  metrics: z.array(MetricView),
  /** The people in the caller's scope, the caller apart. */
  sets: z.array(TargetSetResult),
  /** The caller's own targets, for the team view. */
  own: TargetSetResult,
  /** Each metric summed over `sets`. */
  totals: z.record(Key, z.string()),
});

/** `PUT /v1/targets`: draft values for some people, each at the version the editor saw. */
export const PutTargetsBody = z.strictObject({
  period: TargetPeriod,
  sets: z
    .array(z.strictObject({ userId: z.uuid(), values: TargetValues, version: z.int().min(0) }))
    .min(1)
    .max(200),
});

export const PutTargetsResult = z.object({ sets: z.array(TargetSetResult) });

export const TARGET_SKIP_REASONS = [
  'TARGET_LOCKED',
  'EMPTY',
  'NOTHING_TO_COPY',
  'OWN',
  'OUT_OF_SCOPE',
] as const;

/** `POST /v1/targets/lock`: locks the drafts of these people for the month (BR-08). */
export const LockTargetsBody = z.strictObject({
  period: TargetPeriod,
  userIds: z.array(z.uuid()).min(1).max(200),
});

export const LockTargetsResult = z.object({
  locked: z.array(z.uuid()),
  skipped: z.array(z.object({ userId: z.uuid(), reason: z.enum(TARGET_SKIP_REASONS) })),
});

/** `POST /v1/targets/unlock`: back to draft, with a reason (BR-08). */
export const UnlockTargetBody = z.strictObject({
  userId: z.uuid(),
  period: TargetPeriod,
  reason: z.string().trim().max(500),
});

/** `POST /v1/targets/copy`: the values of an earlier month into these people's drafts. */
export const CopyTargetsBody = z.strictObject({
  period: TargetPeriod,
  from: TargetPeriod,
  userIds: z.array(z.uuid()).min(1).max(200),
});

export const CopyTargetsResult = z.object({
  copied: z.array(z.uuid()),
  skipped: z.array(z.object({ userId: z.uuid(), reason: z.enum(TARGET_SKIP_REASONS) })),
});

/** `GET /v1/account-plans`: an account's planned values for a month (M8). */
export const AccountPlanQuery = z.strictObject({ accountId: z.uuid(), period: Period });

export const AccountPlanResult = z
  .object({
    accountId: z.uuid(),
    period: Period,
    metrics: z.array(MetricView),
    values: z.record(Key, z.string()),
    updatedAt: z.iso.datetime().nullable(),
    updatedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  })
  .meta({ id: 'AccountPlanResult' });

/** `PUT /v1/account-plans`: values for an account's month; `null` clears one. */
export const PutAccountPlanBody = z.strictObject({
  accountId: z.uuid(),
  period: Period,
  values: TargetValues,
});

export type MetricView = z.output<typeof MetricView>;
export type MetricListResult = z.output<typeof MetricListResult>;
export type TargetValues = z.output<typeof TargetValues>;
export type TargetSetResult = z.output<typeof TargetSetResult>;
export type TargetListQuery = z.output<typeof TargetListQuery>;
export type TargetListResult = z.output<typeof TargetListResult>;
export type PutTargetsBody = z.output<typeof PutTargetsBody>;
export type PutTargetsResult = z.output<typeof PutTargetsResult>;
export type LockTargetsBody = z.output<typeof LockTargetsBody>;
export type LockTargetsResult = z.output<typeof LockTargetsResult>;
export type UnlockTargetBody = z.output<typeof UnlockTargetBody>;
export type CopyTargetsBody = z.output<typeof CopyTargetsBody>;
export type CopyTargetsResult = z.output<typeof CopyTargetsResult>;
export type AccountPlanQuery = z.output<typeof AccountPlanQuery>;
export type AccountPlanResult = z.output<typeof AccountPlanResult>;
export type PutAccountPlanBody = z.output<typeof PutAccountPlanBody>;
