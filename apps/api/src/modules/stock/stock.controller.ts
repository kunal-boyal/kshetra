import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  IdParams,
  RecordStockBody,
  RecordStockResult,
  StockCountBody,
  StockCountList,
  StockCountQuery,
  StockCountResult,
  StockLevelsResult,
  StockMovementList,
  StockMovementQuery,
} from '@thelamp/shared';
import { type Access, CurrentAccess, InModule, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { StockService } from './stock.service';

/**
 * Distributors' stock (module M24, BR-62, decision D130): an account's levels, movements and
 * counts; goods in and out by hand; and counts, which adjust a kept ledger at once.
 */
@Controller('v1')
@InModule('inventory')
export class StockController {
  constructor(
    private readonly database: Database,
    private readonly stock: StockService,
  ) {}

  @Get('accounts/:id/stock')
  @Contract({
    tag: 'Stock',
    summary: "An account's stock, item by item, valued at its prices, and where it comes from",
    params: IdParams,
    response: StockLevelsResult,
  })
  @Requires('stock.view')
  levels(@CurrentAccess() access: Access, @Param('id') id: string) {
    const accountId = pathId(id);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.stock.levels(tx, access, accountId),
    );
  }

  @Get('accounts/:id/stock/movements')
  @Contract({
    tag: 'Stock',
    summary: "An account's stock movements, newest first",
    params: IdParams,
    query: StockMovementQuery,
    response: StockMovementList,
  })
  @Requires('stock.view')
  movements(@CurrentAccess() access: Access, @Param('id') id: string, @Query() query: unknown) {
    const accountId = pathId(id);
    const input = StockMovementQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.stock.movements(tx, access, accountId, input),
    );
  }

  @Get('accounts/:id/stock/counts')
  @Contract({
    tag: 'Stock',
    summary: "An account's stock counts, newest first, with what each found",
    params: IdParams,
    query: StockCountQuery,
    response: StockCountList,
  })
  @Requires('stock.view')
  counts(@CurrentAccess() access: Access, @Param('id') id: string, @Query() query: unknown) {
    const accountId = pathId(id);
    const input = StockCountQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.stock.counts(tx, access, accountId, input),
    );
  }

  // The body's ID makes it move stock once: the same entry again answers as it did.
  @Post('stock/movements')
  @HttpCode(201)
  @Contract({
    tag: 'Stock',
    summary: 'Record goods in or out of an account, or a correction, while the app keeps stock',
    body: RecordStockBody,
    response: RecordStockResult,
  })
  @Requires('stock.record')
  async record(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = RecordStockBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `stock_entry:${input.id}`,
        { route: 'POST /v1/stock/movements', by: access.userId, input },
        async () => ({ status: 201, body: await this.stock.record(tx, access, input) }),
      ),
    );
    return result.body;
  }

  // A phone sends a count with its own ID; sending it again answers as the first time.
  @Post('stock/counts')
  @HttpCode(201)
  @Contract({
    tag: 'Stock',
    summary: "Count an account's stock; it sets a kept ledger at once, flagging large gaps",
    body: StockCountBody,
    response: StockCountResult,
  })
  @Requires('stock.count')
  async count(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = StockCountBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `stock_count:${input.id}`,
        { route: 'POST /v1/stock/counts', by: access.userId, input },
        async () => ({ status: 201, body: await this.stock.count(tx, access, input) }),
      ),
    );
    return result.body;
  }
}
