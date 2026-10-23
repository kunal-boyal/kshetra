import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  CreateExportBody,
  DashboardQuery,
  DashboardResult,
  ExportIdParam,
  ExportListQuery,
  ExportListResult,
  ExportResult,
  ReportKeyParam,
  ReportPage,
  ReportQuery,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { notFound, pathId } from '../iam/actor';
import { DashboardService } from './dashboard.service';
import { ExportsService } from './exports.service';
import { ReportsService } from './reports.service';

/**
 * Dashboards, reports and exports (spec 11.2, M18, decisions D62 and D63): the home dashboard, a
 * report read a page at a time, and the same report as a file made in the background, kept for
 * seven days.
 */
@Controller('v1')
export class ReportsController {
  constructor(
    private readonly database: Database,
    private readonly reports: ReportsService,
    private readonly exports: ExportsService,
    private readonly dashboard: DashboardService,
  ) {}

  @Get('dashboard')
  @Contract({
    tag: 'Reports',
    summary: "The home dashboard for a month: the caller's or their team's figures",
    query: DashboardQuery,
    response: DashboardResult,
  })
  @SignedIn()
  home(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = DashboardQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.dashboard.read(tx, access, input.period),
    );
  }

  @Get('reports/:key')
  @Contract({
    tag: 'Reports',
    summary: 'A page of a report for a month, within the caller’s scope',
    params: ReportKeyParam,
    query: ReportQuery,
    response: ReportPage,
  })
  @Requires('report.view')
  page(@CurrentAccess() access: Access, @Param('key') key: string, @Query() query: unknown) {
    const parsed = ReportKeyParam.safeParse({ key });
    if (!parsed.success) throw notFound();
    const input = ReportQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.reports.page(tx, access, parsed.data.key, input),
    );
  }

  @Post('exports')
  @Contract({
    tag: 'Reports',
    summary: 'Ask for a report as a file, made in the background',
    body: CreateExportBody,
    response: ExportResult,
  })
  @Requires('export.create')
  @HttpCode(201)
  async create(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = CreateExportBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `export:${input.id}`,
        { route: 'POST /v1/exports', by: access.userId, input },
        async () => ({ status: 201, body: await this.exports.create(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Get('exports')
  @Contract({
    tag: 'Reports',
    summary: "The caller's exports of the last days, newest first",
    query: ExportListQuery,
    response: ExportListResult,
  })
  @Requires('export.create')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = ExportListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.exports.list(tx, access, input.limit),
    );
  }

  @Get('exports/:id')
  @Contract({
    tag: 'Reports',
    summary: 'One of the caller’s exports, with a short-lived link while its file is kept',
    params: ExportIdParam,
    response: ExportResult,
  })
  @Requires('export.create')
  get(@CurrentAccess() access: Access, @Param('id') id: string) {
    const exportId = pathId(id);
    return this.database.forTenant(access.tenantId, (tx) => this.exports.get(tx, access, exportId));
  }
}
