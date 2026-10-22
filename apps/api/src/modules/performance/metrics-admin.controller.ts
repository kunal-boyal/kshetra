import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  CreateMetricBody,
  MetricDefinitionsResult,
  MetricKeyParam,
  UpdateMetricBody,
  UpdateScoreBody,
} from '@kshetra/metrics';
import { userActor } from '../../platform/audit';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { MetricsAdmin } from './metrics-admin';

/**
 * Editing metrics and the score (M2, spec 5.7, 5.8, decision D65), for those who manage metrics.
 * Every change takes an idempotency key, so one sent twice changes once.
 */
@Controller('v1')
export class MetricsAdminController {
  constructor(
    private readonly database: Database,
    private readonly admin: MetricsAdmin,
  ) {}

  @Get('metric-definitions')
  @Contract({
    tag: 'Planning',
    summary: 'Every metric with its whole definition, and the score',
    response: MetricDefinitionsResult,
  })
  @Requires('metric.manage')
  read(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, (tx) => this.admin.read(tx, access.tenantId));
  }

  @Post('metrics')
  @Contract({
    tag: 'Planning',
    summary: 'Add a metric, worked out from the first of this month',
    body: CreateMetricBody,
    response: MetricDefinitionsResult,
    idempotencyKey: true,
  })
  @Requires('metric.manage')
  @HttpCode(201)
  async create(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = CreateMetricBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/metrics', by: access.userId, input },
        async () => ({
          status: 201,
          body: await this.admin.create(
            tx,
            access.tenantId,
            userActor(access),
            access.userId,
            input.definition,
          ),
        }),
      ),
    );
    return result.body;
  }

  @Put('metrics/:key')
  @Contract({
    tag: 'Planning',
    summary: "Change a metric, or retire it, and work out people's facts again from a date",
    params: MetricKeyParam,
    body: UpdateMetricBody,
    response: MetricDefinitionsResult,
    idempotencyKey: true,
  })
  @Requires('metric.manage')
  async update(
    @CurrentAccess() access: Access,
    @Param('key') metricKey: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = UpdateMetricBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'PUT /v1/metrics/:key', by: access.userId, metricKey, input },
        async () => ({
          status: 200,
          body: await this.admin.update(
            tx,
            access.tenantId,
            userActor(access),
            access.userId,
            metricKey,
            input,
          ),
        }),
      ),
    );
    return result.body;
  }

  @Put('score')
  @Contract({
    tag: 'Planning',
    summary: "Change the score's metrics and weights",
    body: UpdateScoreBody,
    response: MetricDefinitionsResult,
  })
  @Requires('metric.manage')
  updateScore(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = UpdateScoreBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.admin.updateScore(
        tx,
        access.tenantId,
        userActor(access),
        access.userId,
        input.definition,
      ),
    );
  }
}
