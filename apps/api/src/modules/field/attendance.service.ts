import { Injectable } from '@nestjs/common';
import { type AttendanceDayResult, type AttendanceRule, dayStatus, todayIn } from '@thelamp/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { regularisations } from '../../db/schema/attendance';
import { attendanceDays, attendancePolicies, shifts } from '../../db/schema/field';
import type { TenantTx } from '../../platform/database';
import { People } from '../iam/people';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { AttendanceLeave } from './attendance-leave';
import { CalendarsService, offOn } from './calendars.service';

const DEFAULT_RULE: AttendanceRule = { rule: 'punch_is_present' };

/** Every date from `from` to `to`, inclusive, as `YYYY-MM-DD`. */
function dates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = new Date(`${from}T00:00:00Z`); ; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    if (date > to) return out;
    out.push(date);
  }
}

/**
 * Attendance days (BR-23, decisions D47 and D80). A day belongs to the shifts that started on
 * it, on the tenant's clock; its hours are their time on duty, an open shift counting until now.
 * Approved regularisations, approved leave, the person's calendar of holidays and weekly offs, and
 * when they were employed decide the rest. The stored days are what reports read, and are worked
 * out again whenever a shift starts or ends, a regularisation is decided or a holiday changes, and
 * nightly for the day just gone.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly config: TenantConfigService,
    private readonly people: People,
    private readonly calendars: CalendarsService,
    private readonly leave: AttendanceLeave,
  ) {}

  async applyTemplate(tx: TenantTx, tenantId: string, rule: AttendanceRule | undefined) {
    await tx
      .insert(attendancePolicies)
      .values({ tenantId, rule: rule ?? DEFAULT_RULE })
      .onConflictDoNothing();
  }

  /** Replaces the rule (M2, decision D66); attendance days follow it from their next upkeep. */
  async setRule(tx: TenantTx, tenantId: string, rule: AttendanceRule): Promise<void> {
    await tx
      .insert(attendancePolicies)
      .values({ tenantId, rule })
      .onConflictDoUpdate({ target: attendancePolicies.tenantId, set: { rule } });
  }

  async rule(tx: TenantTx, tenantId: string): Promise<AttendanceRule> {
    const [row] = await tx
      .select({ rule: attendancePolicies.rule })
      .from(attendancePolicies)
      .where(eq(attendancePolicies.tenantId, tenantId));
    return row?.rule ?? DEFAULT_RULE;
  }

  /**
   * People's days from `from` to `to`, worked out from their shifts, each saying whether the
   * person's calendar schedules it.
   */
  async days(
    tx: TenantTx,
    tenantId: string,
    userIds: readonly string[] | 'everyone',
    from: string,
    to: string,
    now: Date = new Date(),
  ): Promise<Map<string, (AttendanceDayResult & { shiftIds: string[]; working: boolean })[]>> {
    const { timezone } = await this.config.settings(tx, tenantId);
    const rule = await this.rule(tx, tenantId);
    const today = todayIn(timezone, now);
    const employed = await this.people.employment(
      tx,
      tenantId,
      userIds === 'everyone' ? undefined : userIds,
    );
    if (employed.length === 0) return new Map();
    const localDate = sql<string>`to_char(${shifts.startedAt} at time zone ${timezone}, 'YYYY-MM-DD')`;
    const found = await tx
      .select({
        id: shifts.id,
        userId: shifts.userId,
        date: localDate,
        startedAt: shifts.startedAt,
        endedAt: shifts.endedAt,
        onDutySeconds: shifts.onDutySeconds,
      })
      .from(shifts)
      .where(
        and(
          eq(shifts.tenantId, tenantId),
          inArray(
            shifts.userId,
            employed.map((person) => person.id),
          ),
          sql`${localDate} between ${from} and ${to}`,
        ),
      );
    const ids = employed.map((person) => person.id);
    const calendars = await this.calendars.forPeople(tx, tenantId, employed, from, to);
    const leave = await this.leave.days(tx, tenantId, ids, from, to);
    const fixes = await this.regularised(tx, tenantId, ids, from, to);
    const result = new Map<
      string,
      (AttendanceDayResult & { shiftIds: string[]; working: boolean })[]
    >();
    for (const person of employed) {
      const mine = found.filter((shift) => shift.userId === person.id);
      result.set(
        person.id,
        dates(from, to).map((date) => {
          const theirs = mine.filter((shift) => shift.date === date);
          const seconds = theirs.reduce(
            (total, shift) =>
              total +
              (shift.endedAt
                ? (shift.onDutySeconds ?? 0)
                : Math.max(0, (now.getTime() - shift.startedAt.getTime()) / 1_000)),
            0,
          );
          const hours = Math.round((seconds / 3_600) * 100) / 100;
          const off = offOn(calendars.get(person.id)!, date);
          const fix = fixes.get(person.id)?.get(date) ?? null;
          const { status, value } = dayStatus({
            date,
            today,
            joiningDate: person.joiningDate,
            exitDate: person.exitDate,
            shifts: theirs.length,
            hours,
            rule,
            regularised: fix?.state === 'approved' ? fix.status : null,
            leave: leave.get(person.id)?.get(date) ?? null,
            holiday: off.holiday !== null,
            weeklyOff: off.weeklyOff,
          });
          const starts = theirs.map((shift) => shift.startedAt.getTime());
          const ends = theirs.flatMap((shift) => (shift.endedAt ? [shift.endedAt.getTime()] : []));
          return {
            date,
            status,
            value,
            hours,
            firstIn: starts.length > 0 ? new Date(Math.min(...starts)).toISOString() : null,
            lastOut: ends.length > 0 ? new Date(Math.max(...ends)).toISOString() : null,
            shiftIds: theirs.map((shift) => shift.id),
            holiday: off.holiday,
            regularisation: fix,
            // A working day on the person's calendar, employed or not (provisional pay, D117).
            working: off.holiday === null && !off.weeklyOff,
          };
        }),
      );
    }
    return result;
  }

  /** Waiting and approved regularisations by person and day (BR-28). */
  private async regularised(
    tx: TenantTx,
    tenantId: string,
    userIds: readonly string[],
    from: string,
    to: string,
  ) {
    type Fix = { id: string; status: 'present' | 'half_day'; state: 'pending' | 'approved' };
    const result = new Map<string, Map<string, Fix>>();
    if (userIds.length === 0) return result;
    const rows = await tx
      .select({
        id: regularisations.id,
        userId: regularisations.userId,
        date: regularisations.date,
        status: regularisations.status,
        state: regularisations.state,
      })
      .from(regularisations)
      .where(
        and(
          eq(regularisations.tenantId, tenantId),
          inArray(regularisations.userId, [...userIds]),
          inArray(regularisations.state, ['pending', 'approved']),
          sql`${regularisations.date} between ${from} and ${to}`,
        ),
      );
    for (const row of rows) {
      if (!result.has(row.userId)) result.set(row.userId, new Map());
      result.get(row.userId)!.set(row.date, {
        id: row.id,
        status: row.status as Fix['status'],
        state: row.state as Fix['state'],
      });
    }
    return result;
  }

  /** Works out and keeps people's days for one date, or from it to `to`. */
  async store(
    tx: TenantTx,
    tenantId: string,
    userIds: readonly string[] | 'everyone',
    date: string,
    to = date,
  ): Promise<number> {
    const found = await this.days(tx, tenantId, userIds, date, to);
    const rows = [...found].flatMap(([userId, days]) =>
      days.map((day) => ({
        tenantId,
        userId,
        date: day.date,
        status: day.status,
        value: String(day.value),
        firstIn: day.firstIn ? new Date(day.firstIn) : null,
        lastOut: day.lastOut ? new Date(day.lastOut) : null,
        hours: day.hours.toFixed(2),
        source: { shifts: day.shiftIds },
        computedAt: new Date(),
      })),
    );
    if (rows.length === 0) return 0;
    await tx
      .insert(attendanceDays)
      .values(rows)
      .onConflictDoUpdate({
        target: [attendanceDays.tenantId, attendanceDays.userId, attendanceDays.date],
        set: {
          status: sql`excluded.status`,
          value: sql`excluded.value`,
          firstIn: sql`excluded.first_in`,
          lastOut: sql`excluded.last_out`,
          hours: sql`excluded.hours`,
          source: sql`excluded.source`,
          computedAt: sql`excluded.computed_at`,
        },
      });
    return rows.length;
  }
}
