import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  CreateReportScheduleBody,
  ReportScheduleDetail,
  ReportScheduleIdParam,
  ReportScheduleListQuery,
  ReportScheduleListResult,
  ReportScheduleResult,
  UpdateReportScheduleBody,
} from '@thelamp/shared';
import { type Access, CurrentAccess, InModule, Requires, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { ReportSchedulesService } from './report-schedules.service';

/**
 * Scheduled reports (M18, decision D122): owners keep their schedules, and anyone a schedule sends
 * to sees it and may stop receiving it.
 */
@Controller('v1/report-schedules')
export class ReportSchedulesController {
  constructor(
    private readonly database: Database,
    private readonly schedules: ReportSchedulesService,
  ) {}

  @Get()
  @Contract({
    tag: 'Reports',
    summary: "The caller's scheduled reports, or those sent to them",
    query: ReportScheduleListQuery,
    response: ReportScheduleListResult,
  })
  @SignedIn()
  @InModule('advanced_analytics')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = ReportScheduleListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.schedules.list(tx, access, input.for),
    );
  }

  @Post()
  @Contract({
    tag: 'Reports',
    summary: 'Send a report, or every report, weekly or monthly to chosen people',
    body: CreateReportScheduleBody,
    response: ReportScheduleResult,
  })
  @Requires('report.schedule')
  @HttpCode(201)
  async create(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = CreateReportScheduleBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `report_schedule:${input.id}`,
        { route: 'POST /v1/report-schedules', by: access.userId, input },
        async () => ({ status: 201, body: await this.schedules.create(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Get(':id')
  @Contract({
    tag: 'Reports',
    summary: "One of the caller's schedules, with its latest sends",
    params: ReportScheduleIdParam,
    response: ReportScheduleDetail,
  })
  @Requires('report.schedule')
  get(@CurrentAccess() access: Access, @Param('id') id: string) {
    const scheduleId = pathId(id);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.schedules.get(tx, access, scheduleId),
    );
  }

  @Put(':id')
  @Contract({
    tag: 'Reports',
    summary: 'Change a schedule, or pause or resume it',
    params: ReportScheduleIdParam,
    body: UpdateReportScheduleBody,
    response: ReportScheduleResult,
  })
  @Requires('report.schedule')
  update(@CurrentAccess() access: Access, @Param('id') id: string, @Body() body: unknown) {
    const scheduleId = pathId(id);
    const input = UpdateReportScheduleBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.schedules.update(tx, access, scheduleId, input),
    );
  }

  @Post(':id/end')
  @Contract({
    tag: 'Reports',
    summary: 'End a schedule for good',
    params: ReportScheduleIdParam,
    response: ReportScheduleResult,
    idempotencyKey: true,
  })
  @Requires('report.schedule')
  @HttpCode(200)
  async end(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const scheduleId = pathId(id);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/report-schedules/:id/end', by: access.userId, scheduleId },
        async () => ({ status: 200, body: await this.schedules.end(tx, access, scheduleId) }),
      ),
    );
    return result.body;
  }

  @Post(':id/leave')
  @Contract({
    tag: 'Reports',
    summary: 'Stop receiving a schedule someone sends you',
    params: ReportScheduleIdParam,
    response: ReportScheduleResult,
    idempotencyKey: true,
  })
  @SignedIn()
  @InModule('advanced_analytics')
  @HttpCode(200)
  async leave(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const scheduleId = pathId(id);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/report-schedules/:id/leave', by: access.userId, scheduleId },
        async () => ({ status: 200, body: await this.schedules.leave(tx, access, scheduleId) }),
      ),
    );
    return result.body;
  }
}
