import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  AppError,
  CalendarListQuery,
  CalendarListResult,
  CreateRegularisationBody,
  HolidayBody,
  HolidayParams,
  IdParams,
  issueAt,
  RegularisationListQuery,
  RegularisationListResult,
  RegularisationResult,
  todayIn,
  UserCalendarBody,
  UserCalendarResult,
} from '@thelamp/shared';
import { type Access, CurrentAccess, InModule, Requires, SignedIn } from '../../platform/auth';
import { AuditLog, userActor } from '../../platform/audit';
import { Database } from '../../platform/database';
import { idempotent } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { notFound, pathId } from '../iam/actor';
import { People } from '../iam/people';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { AttendanceService } from './attendance.service';
import { CalendarsService } from './calendars.service';
import { RegularisationsService } from './regularisations.service';

/** Holiday calendars and regularisation (M13, spec 11.2, decision D80). */
@Controller('v1')
export class AttendanceController {
  constructor(
    private readonly database: Database,
    private readonly calendars: CalendarsService,
    private readonly regularisations: RegularisationsService,
    private readonly attendance: AttendanceService,
    private readonly people: People,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {}

  @Get('calendars')
  @Contract({
    tag: 'Attendance',
    summary: 'Every holiday calendar, with its weekly offs and the holidays of a year',
    query: CalendarListQuery,
    response: CalendarListResult,
  })
  @SignedIn()
  @InModule('leave_attendance')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = CalendarListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.calendars.list(tx, access.tenantId, input.year),
    );
  }

  @Put('calendars/:key/holidays/:date')
  @Contract({
    tag: 'Attendance',
    summary: 'Add or rename a holiday, or take it off the calendar',
    params: HolidayParams,
    body: HolidayBody,
    response: CalendarListResult,
  })
  @Requires('calendar.manage')
  setHoliday(@CurrentAccess() access: Access, @Param() params: unknown, @Body() body: unknown) {
    const { key, date } = HolidayParams.parse(params);
    const input = HolidayBody.parse(body);
    return this.database.forTenant(access.tenantId, async (tx) => {
      const people = await this.calendars.setHoliday(
        tx,
        access.tenantId,
        userActor(access),
        key,
        date,
        input,
      );
      // A day already gone is worked out again for everyone on the calendar.
      const { timezone } = await this.config.settings(tx, access.tenantId);
      if (date <= todayIn(timezone) && people.length > 0) {
        await this.attendance.store(tx, access.tenantId, people, date);
      }
      return this.calendars.list(tx, access.tenantId, Number(date.slice(0, 4)));
    });
  }

  @Put('users/:id/calendar')
  @Contract({
    tag: 'Attendance',
    summary: 'The holiday calendar a person keeps; null keeps the default',
    params: IdParams,
    body: UserCalendarBody,
    response: UserCalendarResult,
  })
  @Requires('calendar.manage')
  setCalendar(@CurrentAccess() access: Access, @Param('id') id: string, @Body() body: unknown) {
    const userId = pathId(id);
    const input = UserCalendarBody.parse(body);
    return this.database.forTenant(access.tenantId, async (tx) => {
      if (
        input.calendarKey !== null &&
        !(await this.calendars.exists(tx, access.tenantId, input.calendarKey))
      ) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          issueAt(['calendarKey'], 'There is no calendar with this key'),
        ]);
      }
      const before = await this.people.setCalendar(tx, access.tenantId, userId, input.calendarKey);
      if (before === undefined) throw notFound();
      await this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'user.updated',
        target: { type: 'user', id: userId },
        before: { calendarKey: before },
        after: { calendarKey: input.calendarKey },
      });
      return { userId, calendarKey: input.calendarKey };
    });
  }

  @Post('regularisations')
  @Contract({
    tag: 'Attendance',
    summary: 'Ask to count one of your past days as present or a half day',
    body: CreateRegularisationBody,
    response: RegularisationResult,
  })
  @Requires('regularisation.request')
  @HttpCode(201)
  async create(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = CreateRegularisationBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `regularisation:${input.id}`,
        { route: 'POST /v1/regularisations', by: access.userId, input },
        async () => ({ status: 201, body: await this.regularisations.create(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Get('regularisations')
  @Contract({
    tag: 'Attendance',
    summary: "A person's requests to fix days in a month",
    query: RegularisationListQuery,
    response: RegularisationListResult,
  })
  @SignedIn()
  @InModule('leave_attendance')
  regularisationsList(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = RegularisationListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.regularisations.list(tx, access, input),
    );
  }
}
