import { Body, Controller, Get, Headers, Param, Put, Query, Res } from '@nestjs/common';
import {
  AccountSchemesQuery,
  AccountSchemesResult,
  IdParams,
  SchemeBody,
  SchemeListResult,
  SchemeParams,
  SchemeResult,
} from '@thelamp/shared';
import type { FastifyReply } from 'fastify';
import { userActor } from '../../platform/audit';
import {
  type Access,
  CurrentAccess,
  ForApiClients,
  InModule,
  Requires,
  SignedIn,
} from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { SchemesService } from './schemes.service';

/** Schemes and promotions on orders (BR-55, decision D127), for those who manage them. */
@Controller('v1/schemes')
export class SchemesController {
  constructor(
    private readonly database: Database,
    private readonly schemes: SchemesService,
  ) {}

  @Get()
  @Contract({ tag: 'Orders', summary: 'Every scheme, in use first', response: SchemeListResult })
  @Requires('scheme.manage')
  list(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, async (tx) => ({
      items: await this.schemes.list(tx, access.tenantId),
    }));
  }

  @Put(':schemeId')
  @Contract({
    tag: 'Orders',
    summary: 'Add a scheme with your own ID, or change one at the version you saw',
    params: SchemeParams,
    body: SchemeBody,
    response: SchemeResult,
    idempotencyKey: true,
    also: [{ status: 201, description: 'The scheme was added' }],
  })
  @Requires('scheme.manage')
  async put(
    @CurrentAccess() access: Access,
    @Param('schemeId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const schemeId = pathId(id);
    const input = SchemeBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'PUT /v1/schemes/:id', by: access.userId, schemeId, input },
        async () => {
          const { scheme, created } = await this.schemes.put(
            tx,
            access.tenantId,
            userActor(access),
            schemeId,
            input,
          );
          return { status: created ? 201 : 200, body: scheme };
        },
      ),
    );
    void reply.status(result.status);
    return result.body;
  }
}

/** The schemes that may reach an account's orders (BR-55), for anyone who sees the account. */
@Controller('v1/accounts')
export class AccountSchemesController {
  constructor(
    private readonly database: Database,
    private readonly schemes: SchemesService,
  ) {}

  @Get(':id/schemes')
  @Contract({
    tag: 'Orders',
    summary: "The schemes in use on a date for an account's type and territories",
    params: IdParams,
    query: AccountSchemesQuery,
    response: AccountSchemesResult,
  })
  @SignedIn()
  @ForApiClients('catalogue:read', 'catalogue:write')
  @InModule('orders')
  forAccount(@CurrentAccess() access: Access, @Param('id') id: string, @Query() query: unknown) {
    const accountId = pathId(id);
    const input = AccountSchemesQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.schemes.forAccount(tx, access, accountId, input.date),
    );
  }
}
