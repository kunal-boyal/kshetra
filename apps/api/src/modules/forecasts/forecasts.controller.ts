import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import {
  ForecastParams,
  ForecastQuery,
  ForecastResult,
  IdParams,
  SaveForecastBody,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { notFound, pathId } from '../iam/actor';
import { ForecastsService } from './forecasts.service';

/** Product forecasts per account (BR-54, decision D126). */
@Controller('v1/accounts')
export class ForecastsController {
  constructor(
    private readonly database: Database,
    private readonly forecasts: ForecastsService,
  ) {}

  @Get(':id/forecasts')
  @Contract({
    tag: 'Accounts',
    summary: "An account's forecast by item for some months, with every version",
    params: IdParams,
    query: ForecastQuery,
    response: ForecastResult,
  })
  @RequiresAny('forecast.record', 'account.view')
  get(@CurrentAccess() access: Access, @Param('id') id: string, @Query() query: unknown) {
    const accountId = pathId(id);
    const input = ForecastQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.forecasts.get(tx, access, accountId, input.from, input.to),
    );
  }

  @Put(':id/forecasts/:period')
  @Contract({
    tag: 'Accounts',
    summary: 'Save a new version of an account’s forecast for a month (BR-54)',
    params: ForecastParams,
    body: SaveForecastBody,
    response: ForecastResult,
  })
  @Requires('forecast.record')
  async save(@CurrentAccess() access: Access, @Param() params: unknown, @Body() body: unknown) {
    const parsed = ForecastParams.safeParse(params);
    if (!parsed.success) throw notFound();
    const input = SaveForecastBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `forecast:${input.id}`,
        {
          route: 'PUT /v1/accounts/:id/forecasts/:period',
          by: access.userId,
          ...parsed.data,
          input,
        },
        async () => ({
          status: 200,
          body: await this.forecasts.record(tx, access, {
            id: input.id,
            accountId: parsed.data.id,
            period: parsed.data.period,
            lines: input.lines,
            ...(input.reason ? { reason: input.reason } : {}),
          }),
        }),
      ),
    );
    return result.body;
  }
}
