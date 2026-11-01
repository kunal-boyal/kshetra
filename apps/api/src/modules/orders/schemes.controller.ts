import { Body, Controller, Get, Headers, Param, Put, Res } from '@nestjs/common';
import { SchemeBody, SchemeListResult, SchemeParams, SchemeResult } from '@thelamp/shared';
import type { FastifyReply } from 'fastify';
import { userActor } from '../../platform/audit';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
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
