import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../platform/database';
import { AttendanceService } from '../field/attendance.service';
import { ShiftsService } from '../field/shifts.service';
import { People } from '../iam/people';
import {
  type ColumnSpec,
  personOffset,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/**
 * The attendance register (M18): each person's every day of the month, with the day's status by
 * the tenant's rule, the first start and last end, hours on duty, distance and pauses. It pages by
 * person, so a page holds whole months.
 */
@Injectable()
export class AttendanceRegisterReport extends ReportSource {
  readonly key = 'attendance_register' as const;

  constructor(
    private readonly people: People,
    private readonly attendance: AttendanceService,
    private readonly shifts: ShiftsService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'date', label: 'report.col_date', kind: 'date' },
      { key: 'user_code', label: 'report.col_user_code', kind: 'text' },
      { key: 'user_name', label: 'report.col_user_name', kind: 'text' },
      { key: 'day_status', label: 'report.col_day_status', kind: 'text' },
      { key: 'first_in', label: 'report.col_first_in', kind: 'datetime' },
      { key: 'last_out', label: 'report.col_last_out', kind: 'datetime' },
      { key: 'hours', label: 'report.col_hours', kind: 'number' },
      { key: 'shifts', label: 'report.col_shifts', kind: 'number' },
      { key: 'distance_km', label: 'report.col_distance_km', kind: 'number' },
      { key: 'pauses', label: 'report.col_pauses', kind: 'number' },
      { key: 'paused_minutes', label: 'report.col_paused_minutes', kind: 'number' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const everyone = await this.people.among(tx, context.tenantId, context.people, context.from);
    const days = Number(context.to.slice(8, 10));
    const perPage = Math.max(1, Math.floor(limit / days));
    const offset = personOffset(cursor);
    const team = everyone.slice(offset, offset + perPage);
    const months = await this.attendance.days(
      tx,
      context.tenantId,
      team.map((person) => person.id),
      context.from,
      context.to,
    );
    const facts = await this.shifts.reportFacts(
      tx,
      context.tenantId,
      [...months.values()].flatMap((month) => month.flatMap((day) => day.shiftIds)),
    );
    const rows: ReportRow[] = team.flatMap((person) =>
      (months.get(person.id) ?? []).map((day) => {
        const theirs = day.shiftIds.flatMap((id) => {
          const fact = facts.get(id);
          return fact ? [fact] : [];
        });
        const metres = theirs.reduce((sum, fact) => sum + (fact.distanceM ?? 0), 0);
        return {
          date: day.date,
          user_code: person.code,
          user_name: person.name,
          day_status: context.text(`report.day_${day.status}`),
          first_in: day.firstIn,
          last_out: day.lastOut,
          hours: day.hours,
          shifts: day.shiftIds.length,
          distance_km: Math.round(metres / 100) / 10,
          pauses: theirs.reduce((sum, fact) => sum + fact.pauses, 0),
          paused_minutes: Math.round(
            theirs.reduce((sum, fact) => sum + fact.pausedSeconds, 0) / 60,
          ),
        };
      }),
    );
    const next = offset + team.length;
    return { rows, nextCursor: next < everyone.length ? String(next) : null };
  }
}
