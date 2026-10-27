import { z } from 'zod';
import { Key, LocalizedNoun } from './config';
import { Period } from './planning';
import { MetricView } from './targets';

/** Performance (M9, spec 12.5): actuals from the metric engine, against targets and scores. */

/** A metric as performance shows it: whether the engine computes it yet, and its score weight. */
export const PerformanceMetric = MetricView.extend({
  /** False for sources that wait for their records, such as orders (decision D56). */
  available: z.boolean(),
  /** Its weight in the score, or null when the score leaves it out (BR-06). */
  weight: z.int().nullable(),
}).meta({ id: 'PerformanceMetric' });

/** One metric's figures for a person or a team over a period. */
export const MetricFigures = z.object({
  /** Approved work only (BR-02); null when the engine doesn't compute it, or nothing divides. */
  actual: z.string().nullable(),
  /** What pending submissions would add, shown apart (BR-02). */
  pending: z.string().nullable(),
  target: z.string().nullable(),
  /** Actual against target as a fraction (1 is 100%), uncapped; null without a target. */
  attainment: z.number().nullable(),
});

const Person = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

/** The first territory a person holds today, by code; null for someone who holds none. */
export const PersonTerritory = z.object({ code: z.string(), name: z.string() }).nullable();

/**
 * The person's rank over the month's work up to the end of last week (Sunday on the tenant's
 * clock), computed on read; null when that falls before the month began, or they weren't ranked.
 */
const PreviousRank = z.int().nullable();

/** A ranking group (D8): one designation. */
export const RankingGroup = z.object({ key: Key, name: LocalizedNoun });

export const PerformanceQuery = z.strictObject({
  period: Period,
  /** Another person's month, for those who see their team's; the caller's own by default. */
  userId: z.uuid().optional(),
});

export const PersonPerformance = z
  .object({
    period: Period,
    user: Person,
    territory: PersonTerritory,
    metrics: z.array(PerformanceMetric),
    figures: z.record(Key, MetricFigures),
    /** Whether the person's targets for the month are locked: scores need it (BR-06). */
    locked: z.boolean(),
    score: z.int().nullable(),
    rank: z.int().nullable(),
    previousRank: PreviousRank,
    /** The person's ranking group and how many it holds; null for an unranked designation. */
    group: RankingGroup.extend({ size: z.int() }).nullable(),
    /** Each day's approved values, by metric, for the trend. */
    days: z.array(z.object({ date: z.iso.date(), values: z.record(Key, z.string()) })),
  })
  .meta({ id: 'PersonPerformance' });

export const TeamPerformanceQuery = z.strictObject({ period: Period });

export const TeamPerformance = z
  .object({
    period: Period,
    metrics: z.array(PerformanceMetric),
    rows: z.array(
      z.object({
        user: Person,
        designation: Key,
        territory: PersonTerritory,
        figures: z.record(Key, MetricFigures),
        score: z.int().nullable(),
        /** Within the person's ranking group, across the tenant (BR-07). */
        rank: z.int().nullable(),
        previousRank: PreviousRank,
      }),
    ),
    /** The team's figures: sums, or ratios of summed parts (BR-04). */
    totals: z.record(Key, MetricFigures),
  })
  .meta({ id: 'TeamPerformance' });

export const LeaderboardQuery = z.strictObject({
  period: Period,
  /** A designation key; the caller's own group by default. */
  group: Key.optional(),
});

export const Leaderboard = z
  .object({
    period: Period,
    /** Each ranking group with how many it holds. */
    groups: z.array(RankingGroup.extend({ size: z.int() })),
    group: Key.nullable(),
    /** The metrics behind the scores, with their weights, for the columns and the score's mix. */
    metrics: z.array(PerformanceMetric),
    /** Ranked first by score (BR-07), then the unranked, without a rank. */
    rows: z.array(
      z.object({
        user: Person,
        territory: PersonTerritory,
        figures: z.record(Key, MetricFigures),
        score: z.int().nullable(),
        rank: z.int().nullable(),
        previousRank: PreviousRank,
        you: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'Leaderboard' });

export type PerformanceMetric = z.output<typeof PerformanceMetric>;
export type MetricFigures = z.output<typeof MetricFigures>;
export type RankingGroup = z.output<typeof RankingGroup>;
export type PerformanceQuery = z.output<typeof PerformanceQuery>;
export type PersonPerformance = z.output<typeof PersonPerformance>;
export type TeamPerformanceQuery = z.output<typeof TeamPerformanceQuery>;
export type TeamPerformance = z.output<typeof TeamPerformance>;
export type LeaderboardQuery = z.output<typeof LeaderboardQuery>;
export type Leaderboard = z.output<typeof Leaderboard>;
