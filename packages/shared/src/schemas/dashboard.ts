import { z } from 'zod';
import { Key, LocalizedNoun, LocalizedText } from './config';
import { MetricFigures, PerformanceMetric, PersonTerritory } from './performance';
import { TargetPeriod } from './planning';

/**
 * The home dashboard (M18, spec 8.2, decision D63): one read per month, by the viewer's role. A
 * field user sees their own figures; someone who sees a team sees the team's.
 */

/** The most metrics the home shows as tiles. */
export const DASHBOARD_TILES = 6;

export const DashboardQuery = z.strictObject({ period: TargetPeriod });

const Person = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

/** What waits for the viewer, also read alone for the rail's counts; null for what they can't act on. */
export const DashboardWaiting = z
  .object({
    reviews: z.int().nullable(),
    approvals: z.int().nullable(),
    /** Of the approvals: months of plans, leave with fixed days, and expense claims. */
    plans: z.int().nullable(),
    leave: z.int().nullable(),
    expenses: z.int().nullable(),
  })
  .meta({ id: 'DashboardWaiting' });

/** The most cards a Home layout holds, and the most metrics a tiles or trend card names. */
export const LAYOUT_CARDS_MOST = 12;
export const TILE_METRICS_MOST = 8;
export const TREND_METRICS_MOST = 4;

/** The cards an admin builds a role's Home from (decision D122). */
export const DASHBOARD_CARD_KINDS = [
  'tiles',
  'trend',
  'breakdown',
  'mix',
  'leaderboard',
  'on_duty',
  'waiting',
] as const;
export type DashboardCardKind = (typeof DASHBOARD_CARD_KINDS)[number];

/** How a breakdown card splits a metric: by person in the viewer's scope, or by territory. */
export const BREAKDOWN_BY = ['person', 'territory'] as const;

/**
 * One card of a Home layout. Metric tiles and a trend name their metrics; a breakdown shows one
 * metric by person, or by territory at a geography level; the rest are the standard Home's cards.
 * Each card follows the viewer's own scope and permissions when it is read.
 */
export const DashboardCard = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('tiles'),
      metrics: z.array(Key).min(1).max(TILE_METRICS_MOST),
    }),
    z.strictObject({
      kind: z.literal('trend'),
      metrics: z.array(Key).min(1).max(TREND_METRICS_MOST),
    }),
    z.strictObject({
      kind: z.literal('breakdown'),
      metric: Key,
      by: z.enum(BREAKDOWN_BY),
      /** The geography level a territory breakdown sums to. */
      level: Key.optional(),
    }),
    z.strictObject({ kind: z.literal('mix') }),
    z.strictObject({ kind: z.literal('leaderboard') }),
    z.strictObject({ kind: z.literal('on_duty') }),
    z.strictObject({ kind: z.literal('waiting') }),
  ])
  .meta({ id: 'DashboardCard' });

export const DashboardLayoutCards = z.array(DashboardCard).min(1).max(LAYOUT_CARDS_MOST);

/** A role and its Home layout; null cards keep the standard Home. */
export const DashboardLayoutRow = z.object({
  role: z.object({ id: z.uuid(), key: Key, name: LocalizedText }),
  cards: DashboardLayoutCards.nullable(),
  updatedAt: z.iso.datetime().nullable(),
});

export const DashboardLayoutListResult = z
  .object({
    items: z.array(DashboardLayoutRow),
    /** The metrics a card may name: those worked out, and whether their days and people add up. */
    metrics: z.array(z.object({ key: Key, name: LocalizedNoun, additive: z.boolean() })),
    /** The geography levels a territory breakdown may sum to, highest first. */
    levels: z.array(z.object({ key: Key, name: LocalizedNoun })),
  })
  .meta({ id: 'DashboardLayoutListResult' });

export const DashboardLayoutParam = z.strictObject({ roleId: z.uuid() });

/** `PUT /v1/dashboard-layouts/{roleId}`: the role's cards in order, or null for the standard Home. */
export const UpdateDashboardLayoutBody = z.strictObject({
  cards: DashboardLayoutCards.nullable(),
});

/** One metric split by person or by territory, the largest first. */
export const DashboardBreakdown = z.object({
  metric: Key,
  by: z.enum(BREAKDOWN_BY),
  level: Key.nullable(),
  rows: z.array(
    z.object({
      id: z.uuid().nullable(),
      /** A person's name, or a territory's; null for people under none at that level. */
      label: z.string().nullable(),
      value: z.number().nullable(),
      target: z.number().nullable(),
    }),
  ),
});

export const DashboardResult = z
  .object({
    period: TargetPeriod,
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
            territory: PersonTerritory,
            score: z.int().nullable(),
            rank: z.int().nullable(),
            you: z.boolean(),
          }),
        ),
      })
      .nullable(),
    /** On duty now in the viewer's scope; null without the live map. */
    onDuty: z.int().nullable(),
    /** The first of them, longest on duty first, with where they are and today's visits. */
    onDutyPeople: z
      .array(
        z.object({
          user: z.object({ id: z.uuid(), name: z.string() }),
          /** The account of the visit they are at, or of their last visit today. */
          place: z.string().nullable(),
          visits: z.int(),
          paused: z.boolean(),
          seenAt: z.iso.datetime().nullable(),
        }),
      )
      .nullable(),
    /** People in the viewer's scope on approved leave today; null without the live map. */
    onLeaveToday: z.int().nullable(),
    /** What waits for the viewer; null for what they can't act on. */
    waiting: DashboardWaiting,
    /**
     * The viewer's role's Home layout (decision D122), its cards in order, without those naming
     * a metric or level that is gone; null for the standard Home.
     */
    layout: z.array(DashboardCard).nullable(),
    /** The metrics the layout's trend and breakdown cards name, for their names and units. */
    metrics: z.array(PerformanceMetric),
    /** Each breakdown card's rows, in the layout's order. */
    breakdowns: z.array(DashboardBreakdown),
  })
  .meta({ id: 'DashboardResult' });

export type DashboardQuery = z.output<typeof DashboardQuery>;
export type DashboardResult = z.infer<typeof DashboardResult>;
export type DashboardWaiting = z.infer<typeof DashboardWaiting>;
export type DashboardCard = z.infer<typeof DashboardCard>;
export type DashboardBreakdown = z.infer<typeof DashboardBreakdown>;
export type DashboardLayoutRow = z.infer<typeof DashboardLayoutRow>;
export type DashboardLayoutListResult = z.infer<typeof DashboardLayoutListResult>;
export type UpdateDashboardLayoutBody = z.output<typeof UpdateDashboardLayoutBody>;
