import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CalendarResult,
  type HolidayBody,
  isoWeekday,
  todayIn,
} from '@thelamp/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { calendars, holidays } from '../../db/schema/attendance';
import { type AuditActor, AuditLog } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { People } from '../iam/people';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/** A calendar as a template holds it (spec 5.10). */
export interface CalendarTemplate {
  key: string;
  name: { en: string; hi: string };
  weeklyOffs: number[];
}

/** What a person's calendar says about each day: weekly offs, and holidays by date. */
export interface PersonCalendar {
  weeklyOffs: ReadonlySet<number>;
  holidays: ReadonlyMap<string, string>;
}

const NONE: PersonCalendar = { weeklyOffs: new Set(), holidays: new Map() };

/**
 * Holiday calendars (M13, spec 5.10, decision D80): each tenant's calendars of weekly offs and
 * dated holidays, one of them the default. A person keeps the calendar named on their record, or
 * the default. Optional holidays are listed but count as working days, as only those who take one
 * are off (through leave).
 */
@Injectable()
export class CalendarsService {
  constructor(
    private readonly people: People,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {}

  async applyTemplate(
    tx: TenantTx,
    tenantId: string,
    people: { calendars: readonly CalendarTemplate[]; defaultCalendar: string } | undefined,
  ): Promise<void> {
    const list = people?.calendars ?? [
      { key: 'standard', name: { en: 'Standard', hi: 'सामान्य' }, weeklyOffs: [7] },
    ];
    const fallback = people?.defaultCalendar ?? list[0]!.key;
    await tx
      .insert(calendars)
      .values(
        list.map((calendar) => ({
          tenantId,
          key: calendar.key,
          name: calendar.name,
          weeklyOffs: [...calendar.weeklyOffs],
          isDefault: calendar.key === fallback,
        })),
      )
      .onConflictDoNothing();
  }

  /** The calendars as a template holds them, with the default (M2, decision D66). */
  async section(
    tx: TenantTx,
    tenantId: string,
  ): Promise<{ calendars: CalendarTemplate[]; defaultCalendar: string } | undefined> {
    const rows = await tx
      .select()
      .from(calendars)
      .where(eq(calendars.tenantId, tenantId))
      .orderBy(asc(calendars.key));
    if (rows.length === 0) return undefined;
    return {
      calendars: rows.map((row) => ({ key: row.key, name: row.name, weeklyOffs: row.weeklyOffs })),
      defaultCalendar: rows.find((row) => row.isDefault)?.key ?? rows[0]!.key,
    };
  }

  /**
   * Adds and updates calendars from a configuration file (decision D66), removing none, and
   * moves the default. Says whether anything changed.
   */
  async importSection(
    tx: TenantTx,
    tenantId: string,
    people: { calendars: readonly CalendarTemplate[]; defaultCalendar: string },
  ): Promise<'same' | 'update'> {
    const before = await this.section(tx, tenantId);
    let changed = false;
    for (const calendar of people.calendars) {
      const was = before?.calendars.find((entry) => entry.key === calendar.key);
      if (
        was &&
        JSON.stringify(was.name) === JSON.stringify(calendar.name) &&
        JSON.stringify([...was.weeklyOffs].sort()) ===
          JSON.stringify([...calendar.weeklyOffs].sort())
      ) {
        continue;
      }
      changed = true;
      await tx
        .insert(calendars)
        .values({
          tenantId,
          key: calendar.key,
          name: calendar.name,
          weeklyOffs: [...calendar.weeklyOffs],
        })
        .onConflictDoUpdate({
          target: [calendars.tenantId, calendars.key],
          set: { name: calendar.name, weeklyOffs: [...calendar.weeklyOffs] },
        });
    }
    if (before?.defaultCalendar !== people.defaultCalendar) {
      changed = true;
      await tx
        .update(calendars)
        .set({ isDefault: false })
        .where(and(eq(calendars.tenantId, tenantId), eq(calendars.isDefault, true)));
      await tx
        .update(calendars)
        .set({ isDefault: true })
        .where(and(eq(calendars.tenantId, tenantId), eq(calendars.key, people.defaultCalendar)));
    }
    return changed ? 'update' : 'same';
  }

  /** `GET /v1/calendars`: every calendar with its holidays of a year. */
  async list(tx: TenantTx, tenantId: string, year?: number) {
    const { timezone } = await this.config.settings(tx, tenantId);
    const shown = year ?? Number(todayIn(timezone).slice(0, 4));
    const rows = await tx
      .select()
      .from(calendars)
      .where(eq(calendars.tenantId, tenantId))
      .orderBy(asc(calendars.key));
    const days = await tx
      .select()
      .from(holidays)
      .where(
        and(
          eq(holidays.tenantId, tenantId),
          eq(holidays.active, true),
          sql`${holidays.date} between ${`${shown}-01-01`} and ${`${shown}-12-31`}`,
        ),
      )
      .orderBy(asc(holidays.date));
    return {
      year: shown,
      items: rows.map((row): CalendarResult => ({
        key: row.key,
        name: row.name,
        weeklyOffs: [...row.weeklyOffs].sort(),
        default: row.isDefault,
        holidays: days
          .filter((day) => day.calendarKey === row.key)
          .map((day) => ({ date: day.date, name: day.name, optional: day.optional })),
      })),
    };
  }

  async exists(tx: TenantTx, tenantId: string, key: string): Promise<boolean> {
    const [row] = await tx
      .select({ key: calendars.key })
      .from(calendars)
      .where(and(eq(calendars.tenantId, tenantId), eq(calendars.key, key)));
    return row !== undefined;
  }

  /**
   * `PUT /v1/calendars/{key}/holidays/{date}`: adds a holiday, renames it, or takes it off the
   * calendar. Returns the people whose days it touches, for their attendance to follow.
   */
  async setHoliday(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    key: string,
    date: string,
    body: HolidayBody,
  ): Promise<string[]> {
    if (!(await this.exists(tx, tenantId, key))) {
      throw new AppError('NOT_FOUND', 'There is no calendar with this key.');
    }
    await this.writeHolidays(tx, tenantId, actor, [{ calendarKey: key, date, ...body }]);
    return this.peopleOn(tx, tenantId, key);
  }

  async writeHolidays(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    rows: readonly {
      calendarKey: string;
      date: string;
      name: string;
      optional: boolean;
      active: boolean;
    }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await tx
      .insert(holidays)
      .values(rows.map((row) => ({ tenantId, ...row })))
      .onConflictDoUpdate({
        target: [holidays.tenantId, holidays.calendarKey, holidays.date],
        set: {
          name: sql`excluded.name`,
          optional: sql`excluded.optional`,
          active: sql`excluded.active`,
          updatedAt: new Date(),
        },
      });
    await this.audit.record(tx, tenantId, actor, {
      action: 'holidays.changed',
      target: { type: 'calendar', id: null },
      after: { holidays: rows },
    });
  }

  /** The people who keep a calendar: those who name it, and, for the default, those who name none. */
  async peopleOn(tx: TenantTx, tenantId: string, key: string): Promise<string[]> {
    const [calendar] = await tx
      .select({ isDefault: calendars.isDefault })
      .from(calendars)
      .where(and(eq(calendars.tenantId, tenantId), eq(calendars.key, key)));
    const everyone = await this.people.employment(tx, tenantId);
    return everyone
      .filter((person) =>
        person.calendarKey === null ? (calendar?.isDefault ?? false) : person.calendarKey === key,
      )
      .map((person) => person.id);
  }

  /** Each person's weekly offs and active, non-optional holidays from `from` to `to`. */
  async forPeople(
    tx: TenantTx,
    tenantId: string,
    people: readonly { id: string; calendarKey: string | null }[],
    from: string,
    to: string,
  ): Promise<Map<string, PersonCalendar>> {
    const rows = await tx.select().from(calendars).where(eq(calendars.tenantId, tenantId));
    const fallback = rows.find((row) => row.isDefault)?.key ?? null;
    const keys = [...new Set(people.map((person) => person.calendarKey ?? fallback))].filter(
      (key): key is string => key !== null,
    );
    const days =
      keys.length === 0
        ? []
        : await tx
            .select()
            .from(holidays)
            .where(
              and(
                eq(holidays.tenantId, tenantId),
                inArray(holidays.calendarKey, keys),
                eq(holidays.active, true),
                eq(holidays.optional, false),
                sql`${holidays.date} between ${from} and ${to}`,
              ),
            );
    const byKey = new Map<string, PersonCalendar>(
      rows.map((row) => [
        row.key,
        {
          weeklyOffs: new Set(row.weeklyOffs),
          holidays: new Map(
            days.filter((day) => day.calendarKey === row.key).map((day) => [day.date, day.name]),
          ),
        },
      ]),
    );
    return new Map(
      people.map((person) => [person.id, byKey.get(person.calendarKey ?? fallback ?? '') ?? NONE]),
    );
  }
}

/** Whether a calendar takes a date off: a weekly off, or a holiday by name. */
export function offOn(calendar: PersonCalendar, date: string) {
  return {
    weeklyOff: calendar.weeklyOffs.has(isoWeekday(date)),
    holiday: calendar.holidays.get(date) ?? null,
  };
}
