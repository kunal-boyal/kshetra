import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import {
  IdParams,
  SaveSellThroughBody,
  SellThroughParams,
  SellThroughQuery,
  SellThroughResult,
  SellThroughVersionParams,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { notFound, pathId } from '../iam/actor';
import { SellThroughService } from './sell-through.service';

/** Sell-through by item (BR-53, decision D124): an account's monthly stock statements. */
@Controller('v1/accounts')
export class SellThroughController {
  constructor(
    private readonly database: Database,
    private readonly sellThrough: SellThroughService,
  ) {}

  @Get(':id/sell-through')
  @Contract({
    tag: 'Accounts',
    summary: "An account's stock statement for a month, item by item, with every version",
    params: IdParams,
    query: SellThroughQuery,
    response: SellThroughResult,
  })
  @RequiresAny('sell_through.record', 'account.view')
  get(@CurrentAccess() access: Access, @Param('id') id: string, @Query() query: unknown) {
    const accountId = pathId(id);
    const input = SellThroughQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.sellThrough.get(tx, access, accountId, input.period),
    );
  }

  @Get(':id/sell-through/:period/versions/:version')
  @Contract({
    tag: 'Accounts',
    summary: 'An earlier version of an account’s stock statement for a month',
    params: SellThroughVersionParams,
    response: SellThroughResult,
  })
  @RequiresAny('sell_through.record', 'account.view')
  version(@CurrentAccess() access: Access, @Param() params: unknown) {
    const parsed = SellThroughVersionParams.safeParse(params);
    if (!parsed.success) throw notFound();
    return this.database.forTenant(access.tenantId, (tx) =>
      this.sellThrough.get(tx, access, parsed.data.id, parsed.data.period, parsed.data.version),
    );
  }

  @Put(':id/sell-through/:period')
  @Contract({
    tag: 'Accounts',
    summary: 'Save a new version of an account’s stock statement for a month (BR-53)',
    params: SellThroughParams,
    body: SaveSellThroughBody,
    response: SellThroughResult,
  })
  @Requires('sell_through.record')
  async save(@CurrentAccess() access: Access, @Param() params: unknown, @Body() body: unknown) {
    const parsed = SellThroughParams.safeParse(params);
    if (!parsed.success) throw notFound();
    const input = SaveSellThroughBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `sell_through:${input.id}`,
        {
          route: 'PUT /v1/accounts/:id/sell-through/:period',
          by: access.userId,
          ...parsed.data,
          input,
        },
        async () => ({
          status: 200,
          body: await this.sellThrough.save(tx, access, parsed.data.id, parsed.data.period, input),
        }),
      ),
    );
    return result.body;
  }
}
