import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  AppError,
  AttendanceQuery,
  AttendanceResult,
  CurrentShiftResult,
  EndShiftBody,
  IdParams,
  LocationBatchBody,
  LocationBatchResult,
  PauseParams,
  PauseShiftBody,
  ResumeShiftBody,
  ShiftListQuery,
  ShiftListResult,
  ShiftResult,
  StartShiftBody,
  paidDays,
  scheduledDays,
  HEALTH_LIMITS,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires, RequiresAny } from '../../platform/auth';
import { HealthCounters } from '../../platform/health-counters';
import { Database } from '../../platform/database';
import { idempotent } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { outOfScope, pathId } from '../iam/actor';
import { Scopes } from '../iam/scopes';
import { AttendanceService } from './attendance.service';
import { LocationsService } from './locations.service';
import { ShiftsService } from './shifts.service';

const DEVICE_TIME = {
  name: 'X-Device-Time',
  description:
    "The phone's clock; records sent while it is over 10 minutes out are flagged (BR-44)",
};

/**
 * Shifts and location ingest (spec 11.2 Field group, M5). Punches carry their own IDs and capture
 * times, so a punch sent again from the phone's outbox replays (BR-46) and one sent late from
 * offline counts when it happened.
 */
@Controller('v1')
export class FieldController {
  constructor(
    private readonly database: Database,
    private readonly shifts: ShiftsService,
    private readonly locations: LocationsService,
    private readonly attendance: AttendanceService,
    private readonly scopes: Scopes,
    private readonly health: HealthCounters,
  ) {}

  @Post('shifts')
  @Contract({
    tag: 'Field',
    summary: 'Punch in: start a shift',
    body: StartShiftBody,
    response: ShiftResult,
    headers: [DEVICE_TIME],
  })
  @Requires('shift.use')
  @HttpCode(201)
  async start(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('x-device-time') deviceTime: string | undefined,
  ) {
    const input = StartShiftBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `shift:${input.id}`,
        { route: 'POST /v1/shifts', by: access.userId, input },
        async () => ({
          status: 201,
          body: await this.shifts.start(tx, access, input, deviceTime),
        }),
      ),
    );
    return result.body;
  }

  @Get('shifts/current')
  @Contract({
    tag: 'Field',
    summary: "The caller's open shift, if any",
    response: CurrentShiftResult,
  })
  @Requires('shift.use')
  current(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, async (tx) => ({
      shift: await this.shifts.current(tx, access),
    }));
  }

  @Get('shifts')
  @Contract({
    tag: 'Field',
    summary: "A person's shifts, newest first",
    query: ShiftListQuery,
    response: ShiftListResult,
  })
  @RequiresAny('user.view', 'shift.use')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = ShiftListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) => this.shifts.list(tx, access, input));
  }

  @Post('shifts/:id/end')
  @HttpCode(200)
  @Contract({
    tag: 'Field',
    summary: 'Punch out: end a shift',
    params: IdParams,
    body: EndShiftBody,
    response: ShiftResult,
    headers: [DEVICE_TIME],
  })
  @Requires('shift.use')
  end(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-device-time') deviceTime: string | undefined,
  ) {
    const shiftId = pathId(id);
    const input = EndShiftBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.shifts.end(tx, access, shiftId, input, deviceTime),
    );
  }

  @Post('shifts/:id/pauses')
  @HttpCode(201)
  @Contract({
    tag: 'Field',
    summary: 'Pause tracking on a shift',
    params: IdParams,
    body: PauseShiftBody,
    response: ShiftResult,
  })
  @Requires('tracking.pause')
  pause(@CurrentAccess() access: Access, @Param('id') id: string, @Body() body: unknown) {
    const shiftId = pathId(id);
    const input = PauseShiftBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.shifts.pause(tx, access, shiftId, input),
    );
  }

  @Post('shifts/:id/pauses/:pauseId/resume')
  @HttpCode(200)
  @Contract({
    tag: 'Field',
    summary: 'Resume tracking after a pause',
    params: PauseParams,
    body: ResumeShiftBody,
    response: ShiftResult,
  })
  @Requires('tracking.pause')
  resume(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Param('pauseId') pauseId: string,
    @Body() body: unknown,
  ) {
    const shiftId = pathId(id);
    const pause = pathId(pauseId);
    const input = ResumeShiftBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.shifts.resume(tx, access, shiftId, pause, input),
    );
  }

  @Post('locations/batch')
  @HttpCode(200)
  @Contract({
    tag: 'Field',
    summary: 'Upload location points; each is accepted or refused on its own (BR-36)',
    body: LocationBatchBody,
    response: LocationBatchResult,
  })
  @Requires('shift.use')
  async ingest(@CurrentAccess() access: Access, @Body() body: unknown) {
    if (!access.deviceId) throw new AppError('USE_MOBILE_APP', 'Points come from the mobile app.');
    const input = LocationBatchBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      this.locations.ingest(tx, access, input),
    );
    // The cell's ingest rate, and how much of it arrives late (decision D93).
    const accepted = new Set(result.accepted);
    const now = Date.now();
    const late = input.points.filter(
      (point) =>
        accepted.has(point.id) &&
        now - Date.parse(point.capturedAt) > HEALTH_LIMITS.lateSeconds * 1000,
    ).length;
    this.health.points(accepted.size, late);
    return result;
  }

  @Get('attendance')
  @Contract({
    tag: 'Field',
    summary: "A person's attendance days in a month",
    query: AttendanceQuery,
    response: AttendanceResult,
  })
  @RequiresAny('user.view', 'shift.use')
  attendanceDays(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = AttendanceQuery.parse(query);
    return this.database.forTenant(access.tenantId, async (tx) => {
      if (
        input.userId !== access.userId &&
        !(await this.scopes.reaches(tx, access, input.userId))
      ) {
        throw outOfScope();
      }
      const [year, month] = input.period.split('-').map(Number) as [number, number];
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const found = await this.attendance.days(
        tx,
        access.tenantId,
        [input.userId],
        `${input.period}-01`,
        `${input.period}-${String(last).padStart(2, '0')}`,
      );
      const days = (found.get(input.userId) ?? []).map((day) => ({
        date: day.date,
        status: day.status,
        value: day.value,
        firstIn: day.firstIn,
        lastOut: day.lastOut,
        hours: day.hours,
        holiday: day.holiday,
        regularisation: day.regularisation,
      }));
      return {
        userId: input.userId,
        period: input.period,
        days,
        summary: { scheduled: scheduledDays(days), paid: paidDays(days) },
      };
    });
  }
}
