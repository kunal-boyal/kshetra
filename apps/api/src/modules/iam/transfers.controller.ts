import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import {
  CreateTransferBody,
  IdParams,
  TransferListResult,
  TransferParams,
  TransferResult,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from './actor';
import { TransfersService } from './transfers.service';

/** Transfers (M3): moves to another manager, designation, role or territories from a date on. */
@Controller('v1/users')
export class TransfersController {
  constructor(
    private readonly database: Database,
    private readonly transfers: TransfersService,
  ) {}

  @Post(':id/transfers')
  @Contract({
    tag: 'People',
    summary: 'Transfer a user from a date on: at once for today, or on the day',
    params: IdParams,
    body: CreateTransferBody,
    response: TransferResult,
    idempotencyKey: true,
  })
  @Requires('user.manage')
  @HttpCode(201)
  async create(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const userId = pathId(id);
    const input = CreateTransferBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/users/:id/transfers', by: access.userId, userId, input },
        async () => ({
          status: 201,
          body: await this.transfers.create(tx, access, userId, input),
        }),
      ),
    );
    return result.body;
  }

  @Get(':id/transfers')
  @Contract({
    tag: 'People',
    summary: "A user's transfers, latest first",
    params: IdParams,
    response: TransferListResult,
  })
  @Requires('user.view')
  async list(@CurrentAccess() access: Access, @Param('id') id: string) {
    const userId = pathId(id);
    const items = await this.database.forTenant(access.tenantId, (tx) =>
      this.transfers.list(tx, access, userId),
    );
    return { items };
  }

  @Post(':id/transfers/:transferId/cancel')
  @Contract({
    tag: 'People',
    summary: 'Cancel a transfer that is still to come',
    params: TransferParams,
    response: TransferResult,
  })
  @Requires('user.manage')
  @HttpCode(200)
  cancel(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Param('transferId') transferId: string,
  ) {
    const userId = pathId(id);
    const transfer = pathId(transferId);
    // Cancelling twice gives the same answer, so it needs no key.
    return this.database.forTenant(access.tenantId, (tx) =>
      this.transfers.cancel(tx, access, userId, transfer),
    );
  }
}
