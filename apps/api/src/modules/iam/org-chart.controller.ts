import { Controller, Get, Query } from '@nestjs/common';
import { OrgChartQuery, OrgChartResult } from '@kshetra/shared';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { OrgChartService } from './org-chart.service';

/** The organisation chart (M3). */
@Controller('v1/org-chart')
export class OrgChartController {
  constructor(
    private readonly database: Database,
    private readonly chart: OrgChartService,
  ) {}

  @Get()
  @Contract({
    tag: 'People',
    summary: 'One level of the organisation chart, with team counts by designation',
    query: OrgChartQuery,
    response: OrgChartResult,
  })
  @Requires('user.view')
  level(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = OrgChartQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) => this.chart.level(tx, access, input));
  }
}
