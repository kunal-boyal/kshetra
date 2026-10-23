import { z } from 'zod';
import { MetricDefinition, ScoreDefinition } from './definition';

/**
 * Editing metrics and the score (M2, spec 5.7, 5.8, decision D65). Metric definitions carry form
 * conditions, so their requests live here beside the definitions, not in `@thelamp/shared`.
 */

/** How far back a change may recompute: about three months of days. */
export const RECOMPUTE_MAX_DAYS = 92;

/** A metric as its editors see it: the definition, and whether it is in use. */
export const MetricEntry = z.object({
  definition: MetricDefinition,
  active: z.boolean(),
  version: z.int().min(1),
});

/** `GET /v1/metric-definitions`: every metric, retired ones too, and the score. */
export const MetricDefinitionsResult = z
  .object({ metrics: z.array(MetricEntry), score: ScoreDefinition.nullable() })
  .meta({ id: 'MetricDefinitionsResult' });

/** `POST /v1/metrics`: a new metric, in use from now. */
export const CreateMetricBody = z.strictObject({ definition: MetricDefinition });

/**
 * `PUT /v1/metrics/{key}`: the metric's next definition, whether it stays in use, and the date on
 * the tenant's clock from which people's facts are worked out again.
 */
export const UpdateMetricBody = z.strictObject({
  definition: MetricDefinition,
  active: z.boolean(),
  from: z.iso.date(),
});

/** `PUT /v1/score`: the score's next definition; scores are worked out on reading, so it applies at once. */
export const UpdateScoreBody = z.strictObject({ definition: ScoreDefinition });

export const MetricKeyParam = z.strictObject({ key: z.string() });

export type MetricEntry = z.output<typeof MetricEntry>;
export type MetricDefinitionsResult = z.output<typeof MetricDefinitionsResult>;
export type CreateMetricBody = z.output<typeof CreateMetricBody>;
export type UpdateMetricBody = z.output<typeof UpdateMetricBody>;
export type UpdateScoreBody = z.output<typeof UpdateScoreBody>;
