import { Injectable } from '@nestjs/common';
import { shiftOdometerKm } from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { ShiftsService } from '../field/shifts.service';
import { People } from '../iam/people';
import { monthMoments, offsetPage } from './report-helpers';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/**
 * The location summary (M18): each shift begun in the month, with its time on duty, distance,
 * the points received and kept, its gaps and pauses, how it ended, and the odometer readings at
 * its punches where recorded, beside the tracked distance and never in its place (D99).
 */
@Injectable()
export class LocationSummaryReport extends ReportSource {
  readonly key = 'location_summary' as const;

  constructor(
    private readonly people: People,
    private readonly shifts: ShiftsService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'started_at', label: 'report.col_started_at', kind: 'datetime' },
      { key: 'ended_at', label: 'report.col_ended_at', kind: 'datetime' },
      { key: 'user_code', label: 'report.col_user_code', kind: 'text' },
      { key: 'user_name', label: 'report.col_user_name', kind: 'text' },
      { key: 'on_duty_minutes', label: 'report.col_on_duty_minutes', kind: 'number' },
      { key: 'distance_km', label: 'report.col_distance_km', kind: 'number' },
      { key: 'odometer_open', label: 'report.col_odometer_open', kind: 'number' },
      { key: 'odometer_close', label: 'report.col_odometer_close', kind: 'number' },
      { key: 'odometer_km', label: 'report.col_odometer_km', kind: 'number' },
      { key: 'points', label: 'report.col_points', kind: 'number' },
      { key: 'kept_points', label: 'report.col_kept_points', kind: 'number' },
      { key: 'gaps', label: 'report.col_gaps', kind: 'number' },
      { key: 'pauses', label: 'report.col_pauses', kind: 'number' },
      { key: 'paused_minutes', label: 'report.col_paused_minutes', kind: 'number' },
      { key: 'end_reason', label: 'report.col_end_reason', kind: 'text' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const offset = personOffset(cursor);
    const { from, to } = monthMoments(context);
    const rows = await this.shifts.summaryRows(
      tx,
      context.tenantId,
      context.people,
      from,
      to,
      offset,
      limit,
    );
    const { shown, nextCursor } = offsetPage(rows, offset, limit);
    const people = await this.people.facts(
      tx,
      context.tenantId,
      shown.map((row) => row.userId),
    );
    const facts = await this.shifts.reportFacts(
      tx,
      context.tenantId,
      shown.map((row) => row.id),
    );
    const result: ReportRow[] = shown.map((row) => {
      const fact = facts.get(row.id);
      return {
        started_at: row.startedAt.toISOString(),
        ended_at: row.endedAt?.toISOString() ?? null,
        user_code: people.get(row.userId)?.code ?? null,
        user_name: people.get(row.userId)?.name ?? null,
        on_duty_minutes: row.onDutySeconds === null ? null : Math.round(row.onDutySeconds / 60),
        distance_km:
          fact?.distanceM === null || fact?.distanceM === undefined
            ? null
            : Math.round(fact.distanceM / 100) / 10,
        odometer_open: row.startOdometer === null ? null : Number(row.startOdometer),
        odometer_close: row.endOdometer === null ? null : Number(row.endOdometer),
        odometer_km: (() => {
          const km = shiftOdometerKm(row.startOdometer, row.endOdometer);
          return km === null ? null : Number(km);
        })(),
        points: row.pointCount,
        kept_points: row.keptCount,
        gaps: row.gaps,
        pauses: fact?.pauses ?? 0,
        paused_minutes: Math.round((fact?.pausedSeconds ?? 0) / 60),
        end_reason: row.endReason ? context.text(`work.end_${row.endReason}`) : null,
      };
    });
    return { rows: result, nextCursor };
  }
}
