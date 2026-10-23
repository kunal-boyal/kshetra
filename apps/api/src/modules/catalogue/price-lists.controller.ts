import { Body, Controller, Get, Headers, Param, Put, Query, Res } from '@nestjs/common';
import {
  AccountPricesQuery,
  AccountPricesResult,
  IdParams,
  PriceListBody,
  PriceListItemsBody,
  PriceListItemsQuery,
  PriceListItemsResult,
  PriceListListResult,
  PriceListParams,
  PriceListResult,
} from '@thelamp/shared';
import type { FastifyReply } from 'fastify';
import { userActor } from '../../platform/audit';
import { type Access, CurrentAccess, Requires, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { PriceListsService } from './price-lists.service';

/** Price lists (spec 5.11, 11.2, decision D77), for those who keep the prices. */
@Controller('v1/price-lists')
export class PriceListsController {
  constructor(
    private readonly database: Database,
    private readonly lists: PriceListsService,
  ) {}

  @Get()
  @Contract({
    tag: 'Catalogue',
    summary: 'Every price list, with how many items each prices',
    response: PriceListListResult,
  })
  @Requires('price_list.manage')
  list(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, async (tx) => ({
      items: await this.lists.list(tx, access.tenantId),
    }));
  }

  @Get(':priceListId')
  @Contract({
    tag: 'Catalogue',
    summary: 'One price list',
    params: PriceListParams,
    response: PriceListResult,
  })
  @Requires('price_list.manage')
  get(@CurrentAccess() access: Access, @Param('priceListId') id: string) {
    const listId = pathId(id);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.lists.get(tx, access.tenantId, listId),
    );
  }

  @Put(':priceListId')
  @Contract({
    tag: 'Catalogue',
    summary: 'Add a price list with your own ID, or change one at the version you saw',
    params: PriceListParams,
    body: PriceListBody,
    response: PriceListResult,
    idempotencyKey: true,
    also: [{ status: 201, description: 'The list was added' }],
  })
  @Requires('price_list.manage')
  async put(
    @CurrentAccess() access: Access,
    @Param('priceListId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const listId = pathId(id);
    const input = PriceListBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'PUT /v1/price-lists/:id', by: access.userId, listId, input },
        async () => {
          const { list, created } = await this.lists.put(
            tx,
            access.tenantId,
            userActor(access),
            listId,
            input,
          );
          return { status: created ? 201 : 200, body: list };
        },
      ),
    );
    void reply.status(result.status);
    return result.body;
  }

  @Get(':priceListId/items')
  @Contract({
    tag: 'Catalogue',
    summary: "A price list's prices by item code, a page at a time",
    params: PriceListParams,
    query: PriceListItemsQuery,
    response: PriceListItemsResult,
  })
  @Requires('price_list.manage')
  items(
    @CurrentAccess() access: Access,
    @Param('priceListId') id: string,
    @Query() query: unknown,
  ) {
    const listId = pathId(id);
    const input = PriceListItemsQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.lists.items(tx, access.tenantId, listId, input),
    );
  }

  @Put(':priceListId/items')
  @Contract({
    tag: 'Catalogue',
    summary: "Set and remove a price list's prices, at the version you saw",
    params: PriceListParams,
    body: PriceListItemsBody,
    response: PriceListResult,
    idempotencyKey: true,
  })
  @Requires('price_list.manage')
  async setItems(
    @CurrentAccess() access: Access,
    @Param('priceListId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const listId = pathId(id);
    const input = PriceListItemsBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'PUT /v1/price-lists/:id/items', by: access.userId, listId, input },
        async () => ({
          status: 200,
          body: await this.lists.setItems(tx, access.tenantId, userActor(access), listId, input),
        }),
      ),
    );
    return result.body;
  }
}

/** What an account pays (spec 5.11), for anyone who sees the account. */
@Controller('v1/accounts')
export class AccountPricesController {
  constructor(
    private readonly database: Database,
    private readonly lists: PriceListsService,
  ) {}

  @Get(':id/prices')
  @Contract({
    tag: 'Catalogue',
    summary: 'What each item costs at an account on a date, and from which list',
    params: IdParams,
    query: AccountPricesQuery,
    response: AccountPricesResult,
  })
  @SignedIn()
  prices(@CurrentAccess() access: Access, @Param('id') id: string, @Query() query: unknown) {
    const accountId = pathId(id);
    const input = AccountPricesQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.lists.forAccount(tx, access, accountId, input.date),
    );
  }
}
