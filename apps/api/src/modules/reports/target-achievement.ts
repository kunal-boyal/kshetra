import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';
import { People } from '../iam/people';
import { PerformanceService } from '../performance/performance.service';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/** A number from the engine's decimal text, or null. */
const amount = (value: string | null): number | null => (value === null ? null : Number(value));

/**
 * Target against achievement (M18): for each person, every metric of the month with its target,
 * approved figure, what waits for review, and attainment, and the person's score (BR-06). It pages
 * by person, as the score belongs to the person.
 */
@Injectable()
export class TargetAchievementReport extends ReportSource {
  readonly key = 'target_achievement' as const;

  constructor(
    private readonly people: People,
    private readonly performance: PerformanceService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'user_code', label: 'report.col_user_code', kind: 'text' },
      { key: 'user_name', label: 'report.col_user_name', kind: 'text' },
      { key: 'designation', label: 'report.col_designation', kind: 'text' },
      { key: 'metric', label: 'report.col_metric', kind: 'text' },
      { key: 'target', label: 'report.col_target', kind: 'decimal' },
      { key: 'achieved', label: 'report.col_achieved', kind: 'decimal' },
      { key: 'pending', label: 'report.col_pending', kind: 'decimal' },
      { key: 'attainment', label: 'report.col_attainment', kind: 'percent' },
      { key: 'score', label: 'report.col_score', kind: 'number' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const everyone = await this.people.among(tx, context.tenantId, context.people, context.from);
    const offset = personOffset(cursor);
    // A page holds whole people: as many as their metrics fit in it, at least one.
    const { metrics } = await this.performance.figuresFor(
      tx,
      context.tenantId,
      [],
      context.filters.period,
    );
    const team = everyone.slice(
      offset,
      offset + Math.max(1, Math.floor(limit / Math.max(1, metrics.length))),
    );
    const figures = await this.performance.figuresFor(
      tx,
      context.tenantId,
      team,
      context.filters.period,
    );
    const rows: ReportRow[] = figures.rows.flatMap((person) =>
      figures.metrics.map((metric) => {
        const figure = person.figures[metric.key];
        return {
          user_code: person.user.code,
          user_name: person.user.name,
          designation: person.designation,
          metric: metric.name[context.locale].one,
          target: amount(figure?.target ?? null),
          achieved: amount(figure?.actual ?? null),
          pending: amount(figure?.pending ?? null),
          attainment:
            figure?.attainment === null || figure?.attainment === undefined
              ? null
              : Math.round(figure.attainment * 1000) / 10,
          score: person.score,
        };
      }),
    );
    const next = offset + team.length;
    return { rows, nextCursor: next < everyone.length ? String(next) : null };
  }
}
