import { Controller, Get } from '@nestjs/common';
import { MetricListResult } from '@kshetra/shared';
import { type Access, CurrentAccess, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { MetricsService } from './metrics.service';

/** The tenant's metrics (spec 5.7), for the targets and plans screens. */
@Controller('v1')
export class MetricsController {
  constructor(
    private readonly database: Database,
    private readonly metrics: MetricsService,
  ) {}

  @Get('metrics')
  @Contract({ tag: 'Planning', summary: "The tenant's metrics", response: MetricListResult })
  @RequiresAny('target.view', 'target.edit', 'account_plan.manage', 'account.view')
  list(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, async (tx) => ({
      items: await this.metrics.list(tx, access.tenantId),
    }));
  }
}
