import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApprovalDecisionBody,
  ApprovalInboxQuery,
  ApprovalInboxResult,
  ApprovalMineQuery,
  ApprovalMineResult,
  ApprovalPreviewBody,
  ApprovalPreviewResult,
  ApprovalResult,
  BulkApprovalBody,
  BulkApprovalResult,
} from '@thelamp/shared';
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

  @Get('mine')
  @Contract({
    tag: 'Approvals',
    summary: "The caller's own requests and where each stands",
    query: ApprovalMineQuery,
    response: ApprovalMineResult,
  })
  @SignedIn()
  mine(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = ApprovalMineQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) => this.approvals.mine(tx, access, input));
  }

  @Post('preview')
  @Contract({
    tag: 'Approvals',
    summary: 'Who would decide a request of this type from the caller, without making one',
    body: ApprovalPreviewBody,
    response: ApprovalPreviewResult,
  })
  @SignedIn()
  @HttpCode(200)
  preview(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = ApprovalPreviewBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.approvals.preview(tx, access, input),
    );
  }

  @Post('decisions')
  @Contract({
    tag: 'Approvals',
    summary: 'Approve several requests at once, where their types allow it',
    body: BulkApprovalBody,
    response: BulkApprovalResult,
    idempotencyKey: true,
  })
  @SignedIn()
  @HttpCode(200)
  async approveMany(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = BulkApprovalBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/approvals/decisions', by: access.userId, input },
        async () => ({ status: 200, body: await this.approvals.approveMany(tx, access, input) }),
      ),
    );
    return result.body;
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

  @Post(':instanceId/cancel')
  @Contract({
    tag: 'Approvals',
    summary: 'Withdraw a request of yours that nobody has decided yet',
    params: InstanceParams,
    response: ApprovalResult,
    idempotencyKey: true,
  })
  @SignedIn()
  @HttpCode(200)
  async cancel(
    @CurrentAccess() access: Access,
    @Param('instanceId') id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const instanceId = pathId(id);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/approvals/:instanceId/cancel', by: access.userId, instanceId },
        async () => ({ status: 200, body: await this.approvals.cancel(tx, access, instanceId) }),
      ),
    );
    return result.body;
  }
}
