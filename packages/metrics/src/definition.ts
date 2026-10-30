import { Condition } from '@thelamp/forms';
import {
  isPeriodKey,
  Key,
  LocalizedNoun,
  METRIC_UNITS,
  ORDER_STATUSES,
  TARGET_PERIOD_KINDS,
} from '@thelamp/shared';
import { z } from 'zod';

export { METRIC_UNITS };
export type { MetricUnit } from '@thelamp/shared';

const forms = z.array(Key).min(1).max(50).meta({
  description: 'The forms whose approved submissions count (BR-02)',
});
const accountTypes = z.array(Key).min(1).max(20).optional().meta({
  description: 'Count only accounts of these types. Leave out for every type.',
});
const segment = Key.optional().meta({ description: 'Count only accounts in this segment' });
const statuses = z.array(z.enum(ORDER_STATUSES)).min(1).meta({
  description: 'Count orders in these statuses (BR-19)',
});

/** Where a metric's daily values come from: the source types of spec 5.7. */
export const MetricSource = z
  .discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('submission_count'),
      forms,
      where: Condition.optional().meta({
        description: 'Count only submissions whose fields match this',
      }),
    }),
    z.strictObject({ type: z.literal('submission_field_sum'), forms, field: Key }),
    z.strictObject({
      type: z.literal('product_line_sum'),
      forms,
      field: Key,
      column: z.enum(['quantity', 'value']),
    }),
    z.strictObject({ type: z.literal('distinct_accounts_visited'), forms, accountTypes, segment }),
    z.strictObject({ type: z.literal('coverage_percent'), forms, accountTypes, segment }),
    z.strictObject({ type: z.literal('frequency_compliance_percent'), forms, accountTypes }),
    z.strictObject({ type: z.literal('plan_compliance_percent') }),
    z.strictObject({
      type: z.literal('visit_duration'),
      aggregate: z.enum(['sum', 'average']),
      accountTypes,
    }),
    z.strictObject({
      type: z.literal('order_value'),
      statuses,
      amount: z.enum(['before_tax', 'after_tax']),
    }),
    z.strictObject({
      type: z.literal('order_quantity'),
      statuses,
      measure: z.enum(['base_units', 'kg', 'L']),
    }),
    z.strictObject({ type: z.literal('productive_visits'), accountTypes }),
    z.strictObject({ type: z.literal('order_lines'), statuses }),
    z.strictObject({ type: z.literal('active_days'), forms }),
    z.strictObject({ type: z.literal('new_accounts'), accountType: Key }),
    z.strictObject({ type: z.literal('external') }).meta({
      description: 'Values loaded by import or the API, such as secondary sales from an ERP',
    }),
    z.strictObject({ type: z.literal('ratio'), numerator: Key, denominator: Key }).meta({
      description:
        'One metric divided by another, from summed parts (BR-04); times 100 when the unit is percent',
    }),
  ])
  .meta({ id: 'MetricSource' });

/** A number calculated per user per day and rolled up to any period, team or territory (5.7). */
export const MetricDefinition = z
  .strictObject({
    key: Key,
    name: LocalizedNoun,
    unit: z.enum(METRIC_UNITS),
    direction: z.enum(['higher_is_better', 'lower_is_better']).default('higher_is_better'),
    source: MetricSource,
    targetable: z.boolean().default(true).meta({ description: 'Whether it can carry a target' }),
    visibleRoles: z.array(Key).min(1).max(20).optional().meta({
      description: 'The roles that can see it. Leave out for every role.',
    }),
  })
  .meta({ id: 'MetricDefinition' });

/**
 * The weighted, capped attainment that ranks users (spec 5.8, BR-06). The score definition alone
 * decides which metrics are scored.
 */
export const ScoreDefinition = z
  .strictObject({
    periodType: z.enum(TARGET_PERIOD_KINDS).default('month').meta({
      description:
        "The period targets and scores count over: a month, or a quarter or the year of the tenant's financial year",
    }),
    periodFrom: z
      .string()
      .refine(isPeriodKey, 'Use a period such as 2026-10, FY2026-Q3 or FY2026')
      .optional()
      .meta({ description: 'The first period of `periodType`, when it replaced another kind' }),
    earlierPeriodType: z.enum(TARGET_PERIOD_KINDS).optional().meta({
      description: 'The kind of period before `periodFrom`; the server keeps it',
    }),
    cap: z.number().min(1).max(2).default(1).meta({
      description: 'The highest attainment one metric can contribute: 1 is 100%',
    }),
    rankingGroupBy: z.enum(['designation']).default('designation').meta({
      description: 'Users are ranked within groups; designations decide who is ranked (D8)',
    }),
    metrics: z
      .array(z.strictObject({ metric: Key, weight: z.int().min(1).max(100) }))
      .min(1)
      .max(20),
  })
  .meta({ id: 'ScoreDefinition' });

export type MetricSource = z.output<typeof MetricSource>;
export type MetricSourceType = MetricSource['type'];
export type MetricDefinition = z.output<typeof MetricDefinition>;
export type ScoreDefinition = z.output<typeof ScoreDefinition>;
