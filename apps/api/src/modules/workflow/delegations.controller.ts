import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApprovalDelegation,
  CreateDelegationBody,
  DelegationCandidatesResult,
  DelegationListQuery,
  DelegationListResult,
  IdParams,
} from '@thelamp/shared';
import { type Access, CurrentAccess, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { DelegationsService } from './delegations.service';

/**
 * Approval delegations (M15, decision D113): approvers name who decides for them while away, and
 * those who manage people do so for someone in their scope.
 */
@Controller('v1/approval-delegations')
export class DelegationsController {
  constructor(
    private readonly database: Database,
    private readonly delegations: DelegationsService,
  ) {}

  @Get()
  @Contract({
    tag: 'Approvals',
    summary: 'Delegations given and received, the caller’s or a person’s in their scope',
    query: DelegationListQuery,
    response: DelegationListResult,
  })
  @RequiresAny('approval.act', 'user.manage')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = DelegationListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.delegations.list(tx, access, input),
    );
  }

  @Get('candidates')
  @Contract({
    tag: 'Approvals',
    summary: 'The active people who may approve, to choose a delegate from',
    response: DelegationCandidatesResult,
  })
  @RequiresAny('approval.act', 'user.manage')
  candidates(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, (tx) =>
      this.delegations.candidates(tx, access),
    );
  }

  @Post()
  @Contract({
    tag: 'Approvals',
    summary: 'Name someone to decide for an approver on some days',
    body: CreateDelegationBody,
    response: ApprovalDelegation,
  })
  @RequiresAny('approval.act', 'user.manage')
  @HttpCode(201)
  async create(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = CreateDelegationBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `approval_delegation:${input.id}`,
        { route: 'POST /v1/approval-delegations', by: access.userId, input },
        async () => ({ status: 201, body: await this.delegations.create(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Post(':id/end')
  @Contract({
    tag: 'Approvals',
    summary: 'End a delegation early',
    params: IdParams,
    response: ApprovalDelegation,
    idempotencyKey: true,
  })
  @RequiresAny('approval.act', 'user.manage')
  @HttpCode(200)
  async end(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const delegationId = pathId(id);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/approval-delegations/:id/end', by: access.userId, delegationId },
        async () => ({ status: 200, body: await this.delegations.end(tx, access, delegationId) }),
      ),
    );
    return result.body;
  }
}
