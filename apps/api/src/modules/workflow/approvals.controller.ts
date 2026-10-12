import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApprovalDecisionBody,
  ApprovalInboxQuery,
  ApprovalInboxResult,
  ApprovalResult,
} from '@kshetra/shared';
import { z } from 'zod';
import { type Access, CurrentAccess, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { ApprovalsService } from './approvals.service';

const InstanceParams = z.strictObject({ instanceId: z.uuid() });

/**
 * Approvals (spec 11.2, M15). Being asked to decide is what lets someone decide, so these need
 * no permission of their own; the service checks who is asked (BR-31).
 */
@Controller('v1/approvals')
export class ApprovalsController {
  constructor(
    private readonly database: Database,
    private readonly approvals: ApprovalsService,
  ) {}

  @Get('inbox')
  @Contract({
    tag: 'Approvals',
    summary: 'Requests waiting for the caller to decide',
    query: ApprovalInboxQuery,
    response: ApprovalInboxResult,
  })
  @SignedIn()
  inbox(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = ApprovalInboxQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.approvals.inbox(tx, access, input),
    );
  }

  @Get(':instanceId')
  @Contract({
    tag: 'Approvals',
    summary: 'A request and its steps, for its requester and approvers',
    params: InstanceParams,
    response: ApprovalResult,
  })
  @SignedIn()
  get(@CurrentAccess() access: Access, @Param('instanceId') id: string) {
    return this.database.forTenant(access.tenantId, (tx) =>
      this.approvals.get(tx, access, pathId(id)),
    );
  }

  @Post(':instanceId/decision')
  @Contract({
    tag: 'Approvals',
    summary: 'Approve or reject the current step',
    params: InstanceParams,
    body: ApprovalDecisionBody,
    response: ApprovalResult,
    idempotencyKey: true,
  })
  @SignedIn()
  @HttpCode(200)
  async decide(
    @CurrentAccess() access: Access,
    @Param('instanceId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const instanceId = pathId(id);
    const input = ApprovalDecisionBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/approvals/:instanceId/decision', by: access.userId, instanceId, input },
        async () => ({
          status: 200,
          body: await this.approvals.decide(tx, access, instanceId, input),
        }),
      ),
    );
    return result.body;
  }
}
