import { Body, Controller, Get, Headers, Param, Put } from '@nestjs/common';
import { PutChainBody, PutFallbackBody, WorkflowsResult } from '@thelamp/forms';
import { RequestType } from '@thelamp/shared';
import { z } from 'zod';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { invalid } from '../iam/actor';
import { ChainsService } from './chains.service';

const TypeParams = z.strictObject({ requestType: RequestType });

const ChainResult = WorkflowsResult.shape.chains.element;

/** Approval chains (spec 5.9, 11.2, decision D74): who decides each request type, set by admins. */
@Controller('v1/workflows')
export class WorkflowsController {
  constructor(
    private readonly database: Database,
    private readonly chains: ChainsService,
  ) {}

  @Get()
  @Contract({
    tag: 'Approvals',
    summary: "Every request type's approval chain, and the fallback approver role",
    response: WorkflowsResult,
  })
  @Requires('workflow.manage')
  list(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, (tx) => this.chains.list(tx, access.tenantId));
  }

  // Declared before `:requestType`, so `fallback` never reads as a request type.
  @Put('fallback')
  @Contract({
    tag: 'Approvals',
    summary: 'Set the role that approves when no step of a chain remains',
    body: PutFallbackBody,
    response: WorkflowsResult,
    idempotencyKey: true,
  })
  @Requires('workflow.manage')
  async setFallback(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = PutFallbackBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'PUT /v1/workflows/fallback', by: access.userId, input },
        async () => ({ status: 200, body: await this.chains.setFallback(tx, access, input.role) }),
      ),
    );
    return result.body;
  }

  @Put(':requestType')
  @Contract({
    tag: 'Approvals',
    summary: "Save a new version of a request type's approval chain",
    params: TypeParams,
    body: PutChainBody,
    response: ChainResult,
    idempotencyKey: true,
  })
  @Requires('workflow.manage')
  async setChain(
    @CurrentAccess() access: Access,
    @Param('requestType') requestType: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const parsed = RequestType.safeParse(requestType);
    if (!parsed.success) throw invalid('requestType', 'There is no such request type');
    const input = PutChainBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'PUT /v1/workflows/:requestType', by: access.userId, requestType, input },
        async () => ({
          status: 200,
          body: await this.chains.setChain(tx, access, parsed.data, input),
        }),
      ),
    );
    return result.body;
  }
}
