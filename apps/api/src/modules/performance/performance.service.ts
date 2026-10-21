import { Injectable } from '@nestjs/common';
import { computed, type MetricDefinition, type ScoreDefinition } from '@kshetra/metrics';
import {
  AppError,
  attainment,
  DASHBOARD_TILES,
  type DashboardResult,
  type Leaderboard,
  type MetricFigures,
  monthDates,
  type PerformanceMetric,
  type PersonPerformance,
  rankByScore,
  ratioOf,
  scoreOf,
  type TeamPerformance,
} from '@kshetra/shared';
import { and, asc, between, eq, inArray, sql } from 'drizzle-orm';
import { metricFactAccounts, metricFactsDaily, scoreSnapshots } from '../../db/schema/metrics';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AccountsService } from '../accounts/accounts.service';
import { notFound, outOfScope } from '../iam/actor';
import { People, type PersonFacts } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { MetricsService } from '../metrics/metrics.service';
import { TargetsService } from '../planning/targets.service';

/** A metric's period value with the parts it came from, for ratios and team totals (BR-04). */
interface Value {
  value: number | null;
  numerator: number;
  denominator: number;
  pending: number | null;
  /** The accounts behind a distinct count, so a team's count stays distinct. */
  accounts?: Set<string>;
}

type Values = Map<string, Value>;

/** The tenant's metrics and score, read once per request. */
interface Setup {
  definitions: MetricDefinition[];
  byKey: Map<string, MetricDefinition>;
  score: ScoreDefinition | null;
  metrics: PerformanceMetric[];
}

const DISTINCT = new Set(['distinct_accounts_visited', 'coverage_percent']);

/** Whether a metric's days add up to its month and its people to their team: counts and sums. */
function additive(definition: MetricDefinition): boolean {
  const source = definition.source;
  return !(
    DISTINCT.has(source.type) ||
    source.type === 'ratio' ||
    source.type === 'plan_compliance_percent' ||
    (source.type === 'visit_duration' && source.aggregate === 'average')
  );
}

function text(value: number | null): string | null {
  return value === null ? null : String(Math.round(value * 1000) / 1000);
}

/**
 * Performance (M9): period values summed from the engine's daily facts, against targets, with
 * scores (BR-06) and ranks (BR-07) computed on read from locked targets.
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly metrics: MetricsService,
    private readonly targets: TargetsService,
    private readonly people: People,
    private readonly scopes: Scopes,
    private readonly accounts: AccountsService,
  ) {}

  private async setup(tx: TenantTx, tenantId: string): Promise<Setup> {
    const definitions = await this.metrics.definitions(tx, tenantId);
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
    const score = await this.metrics.score(tx, tenantId);
    const weights = new Map(score?.metrics.map((entry) => [entry.metric, entry.weight]) ?? []);
    const metrics = definitions.map((definition) => ({
      key: definition.key,
      name: definition.name,
      unit: definition.unit,
      direction: definition.direction,
      targetable: definition.targetable,
      available: computed(definition, byKey),
      weight: weights.get(definition.key) ?? null,
    }));
    return { definitions, byKey, score, metrics };
  }

  /**
   * Each person's value of every computed metric over a month: sums of daily facts, distinct
   * counts from the accounts behind them, coverage against the accounts they held, and ratios from
   * summed parts (BR-04).
   */
  private async values(
    tx: TenantTx,
    tenantId: string,
    setup: Setup,
    userIds: readonly string[],
    period: string,
  ): Promise<Map<string, Values>> {
    const result = new Map<string, Values>(userIds.map((id) => [id, new Map()]));
    if (userIds.length === 0) return result;
    const { from, to } = monthDates(period);
    const sums = await tx
      .select({
        userId: metricFactsDaily.userId,
        key: metricFactsDaily.metricKey,
        value: sql<string>`sum(${metricFactsDaily.value})::text`,
        numerator: sql<string | null>`sum(${metricFactsDaily.numerator})::text`,
        denominator: sql<string | null>`sum(${metricFactsDaily.denominator})::text`,
        pending: sql<string | null>`sum(${metricFactsDaily.pending})::text`,
      })
      .from(metricFactsDaily)
      .where(
        and(
          eq(metricFactsDaily.tenantId, tenantId),
          inArray(metricFactsDaily.userId, [...userIds]),
          between(metricFactsDaily.date, from, to),
        ),
      )
      .groupBy(metricFactsDaily.userId, metricFactsDaily.metricKey);
    const summed = new Map(sums.map((row) => [`${row.userId}|${row.key}`, row]));
    const visited = await tx
      .selectDistinct({
        userId: metricFactAccounts.userId,
        key: metricFactAccounts.metricKey,
        accountId: metricFactAccounts.accountId,
      })
      .from(metricFactAccounts)
      .where(
        and(
          eq(metricFactAccounts.tenantId, tenantId),
          inArray(metricFactAccounts.userId, [...userIds]),
          between(metricFactAccounts.date, from, to),
        ),
      );
    const coverage = setup.definitions.filter((d) => d.source.type === 'coverage_percent');
    const held = coverage.length
      ? await this.accounts.heldDuring(tx, tenantId, userIds, from, to)
      : [];

    for (const userId of userIds) {
      const values = result.get(userId)!;
      const ordered = [
        ...setup.definitions.filter((d) => d.source.type !== 'ratio'),
        ...setup.definitions.filter((d) => d.source.type === 'ratio'),
      ];
      for (const definition of ordered) {
        if (!computed(definition, setup.byKey)) continue;
        const source = definition.source;
        const row = summed.get(`${userId}|${definition.key}`);
        const pending = row?.pending == null ? null : Number(row.pending);
        if (source.type === 'distinct_accounts_visited') {
          const accounts = new Set(
            visited
              .filter((entry) => entry.userId === userId && entry.key === definition.key)
              .map((entry) => entry.accountId),
          );
          values.set(definition.key, {
            value: accounts.size,
            numerator: accounts.size,
            denominator: 0,
            pending: null,
            accounts,
          });
        } else if (source.type === 'coverage_percent') {
          const assigned = new Set(
            held
              .filter(
                (entry) =>
                  entry.userId === userId &&
                  (!source.accountTypes || source.accountTypes.includes(entry.typeKey)) &&
                  (!source.segment || entry.segments.includes(source.segment)),
              )
              .map((entry) => entry.accountId),
          );
          const covered = visited.filter(
            (entry) =>
              entry.userId === userId &&
              entry.key === definition.key &&
              assigned.has(entry.accountId),
          ).length;
          values.set(definition.key, {
            value: ratioOf(covered, assigned.size, true),
            numerator: covered,
            denominator: assigned.size,
            pending: null,
          });
        } else if (
          source.type === 'plan_compliance_percent' ||
          (source.type === 'visit_duration' && source.aggregate === 'average')
        ) {
          const numerator = Number(row?.numerator ?? 0);
          const denominator = Number(row?.denominator ?? 0);
          values.set(definition.key, {
            value: ratioOf(numerator, denominator, source.type === 'plan_compliance_percent'),
            numerator,
            denominator,
            pending: null,
          });
        } else if (source.type === 'ratio') {
          const numerator = values.get(source.numerator)?.value ?? 0;
          const denominator = values.get(source.denominator)?.value ?? 0;
          values.set(definition.key, {
            value: ratioOf(numerator, denominator, definition.unit === 'percent'),
            numerator,
            denominator,
            pending: null,
          });
        } else {
          const value = Number(row?.value ?? 0);
          values.set(definition.key, { value, numerator: value, denominator: 0, pending });
        }
      }
    }
    return result;
  }

  /** A team's value of each metric: sums, distinct counts across it, ratios of summed parts. */
  private totals(setup: Setup, values: readonly Values[]): Values {
    const totals: Values = new Map();
    const ordered = [
      ...setup.definitions.filter((d) => d.source.type !== 'ratio'),
      ...setup.definitions.filter((d) => d.source.type === 'ratio'),
    ];
    for (const definition of ordered) {
      if (!computed(definition, setup.byKey)) continue;
      const parts = values.flatMap((entry) => {
        const value = entry.get(definition.key);
        return value ? [value] : [];
      });
      const numerator = parts.reduce((sum, part) => sum + part.numerator, 0);
      const denominator = parts.reduce((sum, part) => sum + part.denominator, 0);
      const source = definition.source;
      if (source.type === 'distinct_accounts_visited') {
        const accounts = new Set(parts.flatMap((part) => [...(part.accounts ?? [])]));
        totals.set(definition.key, {
          value: accounts.size,
          numerator: accounts.size,
          denominator: 0,
          pending: null,
        });
      } else if (source.type === 'ratio') {
        const top = totals.get(source.numerator)?.value ?? 0;
        const bottom = totals.get(source.denominator)?.value ?? 0;
        totals.set(definition.key, {
          value: ratioOf(top, bottom, definition.unit === 'percent'),
          numerator: top,
          denominator: bottom,
          pending: null,
        });
      } else if (
        DISTINCT.has(source.type) ||
        source.type === 'plan_compliance_percent' ||
        (source.type === 'visit_duration' && source.aggregate === 'average')
      ) {
        totals.set(definition.key, {
          value: ratioOf(numerator, denominator, source.type !== 'visit_duration'),
          numerator,
          denominator,
          pending: null,
        });
      } else {
        const pending = parts.some((part) => part.pending !== null)
          ? parts.reduce((sum, part) => sum + (part.pending ?? 0), 0)
          : null;
        totals.set(definition.key, { value: numerator, numerator, denominator: 0, pending });
      }
    }
    return totals;
  }

  private figures(
    setup: Setup,
    values: Values,
    targets: Record<string, string>,
  ): Record<string, MetricFigures> {
    return Object.fromEntries(
      setup.metrics.map((metric) => {
        const value = values.get(metric.key);
        const target = targets[metric.key] ?? null;
        return [
          metric.key,
          {
            actual: text(value?.value ?? null),
            pending: text(value?.pending ?? null),
            target,
            attainment: attainment(
              value?.value ?? null,
              target === null ? null : Number(target),
              metric.direction,
            ),
          },
        ];
      }),
    );
  }

  /** The score of each of these people for the month (BR-06), from their locked targets. */
  private async scores(
    tx: TenantTx,
    tenantId: string,
    setup: Setup,
    userIds: readonly string[],
    period: string,
    known?: Map<string, Values>,
  ): Promise<Map<string, number | null>> {
    const scores = new Map<string, number | null>(userIds.map((id) => [id, null]));
    if (!setup.score || userIds.length === 0) return scores;
    const values =
      known && userIds.every((id) => known.has(id))
        ? known
        : await this.values(tx, tenantId, setup, userIds, period);
    const sets = await this.targets.sets(tx, tenantId, period, userIds);
    for (const userId of userIds) {
      const set = sets.get(userId);
      const actuals = values.get(userId)!;
      scores.set(
        userId,
        scoreOf({
          locked: set?.status === 'locked',
          cap: setup.score.cap,
          metrics: setup.score.metrics.map((entry) => {
            const definition = setup.byKey.get(entry.metric);
            const target = set?.values[entry.metric];
            return {
              key: entry.metric,
              weight: entry.weight,
              direction: definition?.direction ?? 'higher_is_better',
              actual: actuals.get(entry.metric)?.value ?? null,
              target: target === undefined ? null : Number(target),
            };
          }),
        }),
      );
    }
    return scores;
  }

  /** One ranking group's scores and ranks for a month (BR-07): its active people. */
  private async ranking(
    tx: TenantTx,
    tenantId: string,
    setup: Setup,
    group: string,
    period: string,
  ): Promise<{ person: PersonFacts; score: number | null; rank: number | null }[]> {
    const members = await this.people.withDesignation(tx, tenantId, group);
    const scores = await this.scores(
      tx,
      tenantId,
      setup,
      members.map((member) => member.id),
      period,
    );
    return rankByScore(
      members.map((person) => ({ person, score: scores.get(person.id) ?? null })),
    ).map(({ row, rank }) => ({ ...row, rank }));
  }

  private async rankedGroups(tx: TenantTx, tenantId: string) {
    return this.people.rankingGroups(tx, tenantId);
  }

  /** A person's month: the caller's own, or someone their team view reaches. */
  async person(
    tx: TenantTx,
    access: Access,
    period: string,
    userId = access.userId,
  ): Promise<PersonPerformance> {
    const tenantId = access.tenantId;
    if (userId !== access.userId) {
      if (!access.permissions.has('performance.view_team')) {
        throw new AppError('FORBIDDEN', "You can't see other people's performance.");
      }
      if (!(await this.scopes.reaches(tx, access, userId))) {
        const exists = await this.people.facts(tx, tenantId, [userId]);
        throw exists.has(userId) ? outOfScope() : notFound();
      }
    }
    const person = (await this.people.facts(tx, tenantId, [userId])).get(userId);
    if (!person) throw notFound();
    const setup = await this.setup(tx, tenantId);
    const values = (await this.values(tx, tenantId, setup, [userId], period)).get(userId)!;
    const set = (await this.targets.sets(tx, tenantId, period, [userId])).get(userId);
    const groups = await this.rankedGroups(tx, tenantId);
    const group = groups.find((entry) => entry.key === person.designation);
    let score: number | null;
    let rank: number | null = null;
    let size = 0;
    if (group) {
      const ranking = await this.ranking(tx, tenantId, setup, group.key, period);
      const mine = ranking.find((entry) => entry.person.id === userId);
      score = mine?.score ?? null;
      rank = mine?.rank ?? null;
      size = ranking.length;
    } else {
      score = (await this.scores(tx, tenantId, setup, [userId], period)).get(userId) ?? null;
    }
    const { from, to } = monthDates(period);
    const trend = setup.definitions
      .filter((d) => d.source.type !== 'coverage_percent' && computed(d, setup.byKey))
      .map((d) => d.key);
    const days = trend.length
      ? await tx
          .select({
            date: metricFactsDaily.date,
            key: metricFactsDaily.metricKey,
            value: sql<string>`${metricFactsDaily.value}::text`,
          })
          .from(metricFactsDaily)
          .where(
            and(
              eq(metricFactsDaily.tenantId, tenantId),
              eq(metricFactsDaily.userId, userId),
              between(metricFactsDaily.date, from, to),
              inArray(metricFactsDaily.metricKey, trend),
            ),
          )
          .orderBy(asc(metricFactsDaily.date))
      : [];
    const byDate = new Map<string, Record<string, string>>();
    for (const row of days) {
      const entry = byDate.get(row.date) ?? {};
      entry[row.key] = text(Number(row.value))!;
      byDate.set(row.date, entry);
    }
    return {
      period,
      user: { id: person.id, code: person.code, name: person.name },
      metrics: setup.metrics,
      figures: this.figures(setup, values, set?.values ?? {}),
      locked: set?.status === 'locked',
      score,
      rank,
      group: group ? { ...group, size } : null,
      days: [...byDate].map(([date, values]) => ({ date, values })),
    };
  }

  /** The month for everyone the caller's scope reaches, but the caller, with the team's totals. */
  async team(tx: TenantTx, access: Access, period: string): Promise<TeamPerformance> {
    const tenantId = access.tenantId;
    const team = (
      await this.people.matching(tx, tenantId, await this.scopes.users(tx, access))
    ).filter((person) => person.id !== access.userId);
    return this.figuresFor(tx, tenantId, team, period);
  }

  /**
   * Some people's figures, score and rank for a month, with the group's totals: the team view, and
   * the target against achievement report (M18), which names its people itself.
   */
  async figuresFor(
    tx: TenantTx,
    tenantId: string,
    team: readonly PersonFacts[],
    period: string,
  ): Promise<TeamPerformance> {
    const setup = await this.setup(tx, tenantId);
    const ids = team.map((person) => person.id);
    const values = await this.values(tx, tenantId, setup, ids, period);
    const sets = await this.targets.sets(tx, tenantId, period, ids);
    const ranked = new Set((await this.rankedGroups(tx, tenantId)).map((group) => group.key));
    const standing = new Map<string, { score: number | null; rank: number | null }>();
    for (const group of new Set(team.map((person) => person.designation))) {
      if (!ranked.has(group)) continue;
      for (const entry of await this.ranking(tx, tenantId, setup, group, period)) {
        standing.set(entry.person.id, { score: entry.score, rank: entry.rank });
      }
    }
    const unranked = team.filter((person) => !ranked.has(person.designation)).map((p) => p.id);
    const loose = await this.scores(tx, tenantId, setup, unranked, period, values);
    const targetTotals: Record<string, string> = {};
    for (const metric of setup.metrics) {
      const amounts = ids.flatMap((id) => {
        const value = sets.get(id)?.values[metric.key];
        return value === undefined ? [] : [Number(value)];
      });
      if (amounts.length > 0) {
        targetTotals[metric.key] = text(amounts.reduce((sum, amount) => sum + amount, 0))!;
      }
    }
    return {
      period,
      metrics: setup.metrics,
      rows: team.map((person) => ({
        user: { id: person.id, code: person.code, name: person.name },
        designation: person.designation,
        figures: this.figures(setup, values.get(person.id)!, sets.get(person.id)?.values ?? {}),
        score: standing.get(person.id)?.score ?? loose.get(person.id) ?? null,
        rank: standing.get(person.id)?.rank ?? null,
      })),
      totals: this.figures(setup, this.totals(setup, [...values.values()]), targetTotals),
    };
  }

  /**
   * The home dashboard's figures (M18, decision D63): the team's when the caller sees a team, else
   * their own; the tiles are the metrics with a target, or the first ones; each additive tile has a
   * daily trend of approved and pending; and the top of the caller's leaderboard.
   */
  async dashboard(
    tx: TenantTx,
    access: Access,
    period: string,
  ): Promise<
    Pick<DashboardResult, 'view' | 'people' | 'tiles' | 'trend' | 'leaderboard'> & { ids: string[] }
  > {
    const tenantId = access.tenantId;
    const setup = await this.setup(tx, tenantId);
    const team =
      access.scope !== 'self' && access.permissions.has('performance.view_team')
        ? (await this.people.matching(tx, tenantId, await this.scopes.users(tx, access))).filter(
            (person) => person.id !== access.userId,
          )
        : [];
    const view = team.length > 0 ? 'team' : 'self';
    let figures: Record<string, MetricFigures>;
    let ids: string[];
    if (view === 'team') {
      figures = (await this.figuresFor(tx, tenantId, team, period)).totals;
      ids = team.map((person) => person.id);
    } else {
      const values = (await this.values(tx, tenantId, setup, [access.userId], period)).get(
        access.userId,
      )!;
      const set = (await this.targets.sets(tx, tenantId, period, [access.userId])).get(
        access.userId,
      );
      figures = this.figures(setup, values, set?.values ?? {});
      ids = [access.userId];
    }
    const available = setup.metrics.filter((metric) => metric.available);
    const targeted = available.filter((metric) => figures[metric.key]?.target != null);
    const tiles = (targeted.length > 0 ? targeted : available)
      .slice(0, DASHBOARD_TILES)
      .map((metric) => ({ metric, figures: figures[metric.key]! }));
    const trendKeys = tiles
      .map((tile) => tile.metric.key)
      .filter((key) => {
        const definition = setup.byKey.get(key);
        return definition !== undefined && additive(definition);
      });
    const { from, to } = monthDates(period);
    const days =
      trendKeys.length && ids.length
        ? await tx
            .select({
              date: metricFactsDaily.date,
              key: metricFactsDaily.metricKey,
              value: sql<string>`sum(${metricFactsDaily.value})::text`,
              pending: sql<string | null>`sum(${metricFactsDaily.pending})::text`,
            })
            .from(metricFactsDaily)
            .where(
              and(
                eq(metricFactsDaily.tenantId, tenantId),
                inArray(metricFactsDaily.userId, ids),
                between(metricFactsDaily.date, from, to),
                inArray(metricFactsDaily.metricKey, trendKeys),
              ),
            )
            .groupBy(metricFactsDaily.date, metricFactsDaily.metricKey)
            .orderBy(asc(metricFactsDaily.date))
        : [];
    const trend = trendKeys.map((key) => ({
      key,
      days: days
        .filter((row) => row.key === key)
        .map((row) => ({
          date: row.date,
          actual: Number(row.value),
          pending: row.pending === null ? null : Number(row.pending),
        })),
    }));
    let leaderboard: DashboardResult['leaderboard'] = null;
    if (access.permissions.has('leaderboard.view')) {
      const board = await this.leaderboard(tx, access, period);
      const group = board.groups.find((entry) => entry.key === board.group);
      if (group) {
        const top = board.rows.slice(0, 5);
        const you = board.rows.find((row) => row.you);
        leaderboard = {
          group: { key: group.key, name: group.name },
          rows: you && !top.includes(you) ? [...top, you] : top,
        };
      }
    }
    return { view, people: view === 'team' ? team.length : 1, tiles, trend, leaderboard, ids };
  }

  /** A ranking group's leaderboard for a month: the caller's own group unless one is named. */
  async leaderboard(
    tx: TenantTx,
    access: Access,
    period: string,
    group?: string,
  ): Promise<Leaderboard> {
    const tenantId = access.tenantId;
    const groups = await this.rankedGroups(tx, tenantId);
    const me = (await this.people.facts(tx, tenantId, [access.userId])).get(access.userId);
    const chosen =
      group ??
      (groups.some((entry) => entry.key === me?.designation) ? me?.designation : undefined) ??
      groups[0]?.key ??
      null;
    if (chosen !== null && !groups.some((entry) => entry.key === chosen)) {
      throw notFound();
    }
    const setup = await this.setup(tx, tenantId);
    const ranking = chosen ? await this.ranking(tx, tenantId, setup, chosen, period) : [];
    return {
      period,
      groups,
      group: chosen,
      rows: ranking.map((entry) => ({
        user: { id: entry.person.id, code: entry.person.code, name: entry.person.name },
        score: entry.score,
        rank: entry.rank,
        you: entry.person.id === access.userId,
      })),
    };
  }

  /** Writes every ranking group's scores and ranks for a month, for history (spec 12.5). */
  async snapshot(tx: TenantTx, tenantId: string, period: string): Promise<number> {
    const setup = await this.setup(tx, tenantId);
    let written = 0;
    for (const group of await this.rankedGroups(tx, tenantId)) {
      const ranking = await this.ranking(tx, tenantId, setup, group.key, period);
      if (ranking.length === 0) continue;
      await tx
        .insert(scoreSnapshots)
        .values(
          ranking.map((entry) => ({
            tenantId,
            period,
            userId: entry.person.id,
            score: entry.score,
            rank: entry.rank,
            groupKey: group.key,
          })),
        )
        .onConflictDoUpdate({
          target: [scoreSnapshots.tenantId, scoreSnapshots.period, scoreSnapshots.userId],
          set: {
            score: sql`excluded.score`,
            rank: sql`excluded.rank`,
            groupKey: sql`excluded.group_key`,
            computedAt: sql`now()`,
          },
        });
      written += ranking.length;
    }
    return written;
  }
}
