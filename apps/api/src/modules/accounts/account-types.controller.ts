import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import {
  AccountTypeListResult,
  AccountTypeView,
  CreateAccountTypeBody,
  PublishAccountTypeBody,
} from '@kshetra/forms';
import { IdParams } from '@kshetra/shared';
import { userActor } from '../../platform/audit';
import { type Access, CurrentAccess, Requires, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { AccountTypesService } from './account-types.service';

/** Account types (spec 5.5, 11.2): read by every app, added and versioned by admins (M2). */
@Controller('v1/account-types')
export class AccountTypesController {
  constructor(
    private readonly database: Database,
    private readonly types: AccountTypesService,
  ) {}

  @Get()
  @Contract({
    tag: 'Accounts',
    summary: "The tenant's account types at their current versions",
    response: AccountTypeListResult,
  })
  // The config bundle hands every app the same definitions.
  @SignedIn()
  list(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, async (tx) => ({
      items: this.types.views(await this.types.list(tx, access.tenantId)),
    }));
  }

  @Post()
  @Contract({
    tag: 'Accounts',
    summary: 'Add an account type, at version 1',
    body: CreateAccountTypeBody,
    response: AccountTypeView,
  })
  @Requires('settings.manage')
  @HttpCode(201)
  async create(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = CreateAccountTypeBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `account_type:${input.id}`,
        { route: 'POST /v1/account-types', by: access.userId, input },
        async () => ({
          status: 201,
          body: await this.types.create(
            tx,
            access.tenantId,
            userActor(access),
            access.userId,
            input.id,
            input.definition,
          ),
        }),
      ),
    );
    return result.body;
  }

  @Post(':id/versions')
  @Contract({
    tag: 'Accounts',
    summary: "Publish the next version of a type's definition",
    params: IdParams,
    body: PublishAccountTypeBody,
    response: AccountTypeView,
    idempotencyKey: true,
  })
  @Requires('settings.manage')
  @HttpCode(201)
  async publish(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const typeId = pathId(id);
    const input = PublishAccountTypeBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/account-types/:id/versions', by: access.userId, typeId, input },
        async () => ({
          status: 201,
          body: await this.types.publish(
            tx,
            access.tenantId,
            userActor(access),
            access.userId,
            typeId,
            input.definition,
          ),
        }),
      ),
    );
    return result.body;
  }
}
