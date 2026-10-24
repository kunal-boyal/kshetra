import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  FulfilmentBody,
  IdParams,
  LineDecisionsBody,
  OrderDecisionBody,
  OrderListQuery,
  OrderListResult,
  OrderResult,
  PlaceOrderBody,
} from '@thelamp/shared';
import { type Access, CurrentAccess, InModule, Requires, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { OrdersService } from './orders.service';

/** Orders (M10, spec 11.2, decision D78). */
@Controller('v1/orders')
export class OrdersController {
  constructor(
    private readonly database: Database,
    private readonly orders: OrdersService,
  ) {}

  @Post()
  @Contract({
    tag: 'Orders',
    summary: 'Place an order with its own ID; the server prices it and asks for approval',
    body: PlaceOrderBody,
    response: OrderResult,
  })
  @Requires('order.create')
  @HttpCode(201)
  async place(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = PlaceOrderBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `order:${input.id}`,
        { route: 'POST /v1/orders', by: access.userId, input },
        async () => ({ status: 201, body: await this.orders.place(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Get()
  @Contract({
    tag: 'Orders',
    summary: 'The orders the caller sees, newest first',
    query: OrderListQuery,
    response: OrderListResult,
  })
  @SignedIn()
  @InModule('orders')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = OrderListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) => this.orders.list(tx, access, input));
  }

  @Get(':id')
  @Contract({ tag: 'Orders', summary: 'One order', params: IdParams, response: OrderResult })
  @SignedIn()
  @InModule('orders')
  get(@CurrentAccess() access: Access, @Param('id') id: string) {
    const orderId = pathId(id);
    return this.database.forTenant(access.tenantId, (tx) => this.orders.get(tx, access, orderId));
  }

  @Post(':id/decision')
  @Contract({
    tag: 'Orders',
    summary: 'Accept or reject the whole order at your step',
    params: IdParams,
    body: OrderDecisionBody,
    response: OrderResult,
    idempotencyKey: true,
  })
  @Requires('order.decide')
  @HttpCode(200)
  async decide(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const orderId = pathId(id);
    const input = OrderDecisionBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/orders/:id/decision', by: access.userId, orderId, input },
        async () => ({ status: 200, body: await this.orders.decide(tx, access, orderId, input) }),
      ),
    );
    return result.body;
  }

  @Post(':id/line-decisions')
  @Contract({
    tag: 'Orders',
    summary: 'Decide every line at a step that decides line by line',
    params: IdParams,
    body: LineDecisionsBody,
    response: OrderResult,
    idempotencyKey: true,
  })
  @Requires('order.line_decide')
  @HttpCode(200)
  async decideLines(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const orderId = pathId(id);
    const input = LineDecisionsBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/orders/:id/line-decisions', by: access.userId, orderId, input },
        async () => ({
          status: 200,
          body: await this.orders.decideLines(tx, access, orderId, input),
        }),
      ),
    );
    return result.body;
  }

  @Post(':id/fulfilment')
  @Contract({
    tag: 'Orders',
    summary: 'Record what went out on accepted lines, or cancel an accepted order',
    params: IdParams,
    body: FulfilmentBody,
    response: OrderResult,
    idempotencyKey: true,
  })
  @Requires('order.fulfil')
  @HttpCode(200)
  async fulfil(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const orderId = pathId(id);
    const input = FulfilmentBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/orders/:id/fulfilment', by: access.userId, orderId, input },
        async () => ({ status: 200, body: await this.orders.fulfil(tx, access, orderId, input) }),
      ),
    );
    return result.body;
  }
}
