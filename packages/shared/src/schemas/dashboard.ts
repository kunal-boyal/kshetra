import { z } from 'zod';
import { Key, LocalizedNoun } from './config';
import { MetricFigures, PerformanceMetric } from './performance';
import { Period } from './planning';

/**
 * The home dashboard (M18, spec 8.2, decision D63): one read per month, by the viewer's role. A
 * field user sees their own figures; someone who sees a team sees the team's.
 */

/** The most metrics the home shows as tiles. */
export const DASHBOARD_TILES = 6;

export const DashboardQuery = z.strictObject({ period: Period });

const Person = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

export const DashboardResult = z
  .object({
    period: Period,
    /** Whose figures: the viewer's own, or the team their scope reaches. */
    view: z.enum(['self', 'team']),
    /** How many people the team view sums; 1 for the viewer's own. */
    people: z.int(),
    /** Metrics with a target this month, in the template's order, or its first ones. */
    tiles: z.array(z.object({ metric: PerformanceMetric, figures: MetricFigures })),
    /** Each tile metric by day: approved, and what pending submissions would add (BR-02). */
    trend: z.array(
      z.object({
        key: Key,
        days: z.array(
          z.object({
            date: z.iso.date(),
            actual: z.number().nullable(),
            pending: z.number().nullable(),
          }),
        ),
      }),
    ),
    /** Submissions of the month by form and status. */
    mix: z.array(
      z.object({
        form: z.object({ key: Key, name: LocalizedNoun }),
        approved: z.int(),
        pending: z.int(),
        rejected: z.int(),
      }),
    ),
    /** The top of the viewer's ranking group, and the viewer; null without one or the permission. */
    leaderboard: z
      .object({
        group: z.object({ key: Key, name: LocalizedNoun }),
        rows: z.array(
          z.object({
            user: Person,
            score: z.int().nullable(),
            rank: z.int().nullable(),
            you: z.boolean(),
          }),
        ),
      })
      .nullable(),
    /** On duty now in the viewer's scope; null without the live map. */
    onDuty: z.int().nullable(),
    /** What waits for the viewer; null for what they can't act on. */
    waiting: z.object({ reviews: z.int().nullable(), approvals: z.int().nullable() }),
  })
  .meta({ id: 'DashboardResult' });

export type DashboardQuery = z.output<typeof DashboardQuery>;
export type DashboardResult = z.infer<typeof DashboardResult>;
