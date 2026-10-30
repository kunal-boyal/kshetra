import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type ImportProblem, todayIn } from '@thelamp/shared';
import { eq } from 'drizzle-orm';
import { calendars } from '../../db/schema/attendance';
import { userActor } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { cellDate, cellText, cellYesNo, isEmptyCell } from '../imports/reading';
import {
  type ImportContext,
  ImportRefused,
  type ImportRow,
  type ImportTargetSource,
  ImportTargets,
  type TargetField,
  checked,
  type ExampleRow,
} from '../imports/targets';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { AttendanceService } from './attendance.service';
import { CalendarsService } from './calendars.service';

interface Planned {
  calendarKey: string;
  date: string;
  name: string;
  optional: boolean;
  active: boolean;
}

/**
 * Holiday imports (Appendix B.7): calendar, date, name, and whether the holiday is optional. A
 * calendar is found by key or by name; a date already on it is renamed (decision D80).
 */
@Injectable()
export class HolidaysImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'holidays';
  readonly permission = 'calendar.manage';

  constructor(
    private readonly targets: ImportTargets,
    private readonly calendars: CalendarsService,
    private readonly attendance: AttendanceService,
    private readonly config: TenantConfigService,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(): Promise<TargetField[]> {
    return [
      { key: 'calendar', names: ['Calendar'], required: true },
      { key: 'date', names: ['Date'], required: true },
      { key: 'name', names: ['Name', 'Holiday'], required: true },
      { key: 'optional', names: ['Optional'], required: false },
    ];
  }

  /** Two national holidays of the coming year on the tenant's default calendar (D111). */
  async example(tx: TenantTx, tenantId: string): Promise<ExampleRow[]> {
    const { items } = await this.calendars.list(tx, tenantId);
    const calendar = items.find((entry) => entry.default) ?? items[0];
    const year = new Date().getUTCFullYear() + 1;
    const name = calendar?.key ?? '';
    return [
      { calendar: name, date: `${year}-01-26`, name: 'Republic Day', optional: 'No' },
      { calendar: name, date: `${year}-08-15`, name: 'Independence Day', optional: 'No' },
    ];
  }

  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const tenantId = context.access.tenantId;
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const known = await tx
      .select({ key: calendars.key, name: calendars.name })
      .from(calendars)
      .where(eq(calendars.tenantId, tenantId));
    const find = (text: string) => {
      const wanted = text.trim().toLowerCase();
      return known.find(
        (calendar) =>
          calendar.key === wanted ||
          calendar.name.en.toLowerCase() === wanted ||
          calendar.name.hi.toLowerCase() === wanted,
      )?.key;
    };
    const seen = new Map<string, number>();
    const planned: Planned[] = [];
    for (const { row, cells } of rows) {
      const calendarKey = find(cellText(cells.calendar));
      if (!calendarKey) problem(row, 'calendar', 'There is no calendar with this name or key');
      const date = cellDate(cells.date);
      if (!date) problem(row, 'date', 'Write the date as 2026-10-24 or 24-10-2026');
      const name = cellText(cells.name).trim();
      if (!name) problem(row, 'name', 'Fill in the holiday’s name');
      else if (name.length > 80) problem(row, 'name', 'Use at most 80 characters');
      let optional = false;
      if (cells.optional !== undefined && !isEmptyCell(cells.optional, context.emptyValues)) {
        const yes = cellYesNo(cells.optional);
        if (yes === null) problem(row, 'optional', 'Write yes or no');
        else optional = yes;
      }
      if (!calendarKey || !date || !name || name.length > 80) continue;
      const pair = `${calendarKey}|${date}`;
      if (seen.has(pair)) {
        problem(row, 'date', `This calendar and day are in row ${seen.get(pair)} already`);
        continue;
      }
      seen.set(pair, row);
      planned.push({ calendarKey, date, name, optional, active: true });
    }
    return { problems, planned };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    return checked((await this.plan(tx, rows, context)).problems);
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    const tenantId = context.access.tenantId;
    await this.calendars.writeHolidays(tx, tenantId, userActor(context.access), planned);
    // Days already gone are worked out again for the people on each calendar.
    const today = todayIn((await this.config.settings(tx, tenantId)).timezone);
    for (const key of new Set(planned.map((entry) => entry.calendarKey))) {
      const people = await this.calendars.peopleOn(tx, tenantId, key);
      if (people.length === 0) continue;
      for (const entry of planned.filter((one) => one.calendarKey === key && one.date <= today)) {
        await this.attendance.store(tx, tenantId, people, entry.date);
      }
    }
    return { created: planned.length, updated: 0 };
  }
}
