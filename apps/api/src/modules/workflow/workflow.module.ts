import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { Approvers } from './approvers';
import { ChainsService } from './chains.service';
import { DelegationsController } from './delegations.controller';
import { DelegationsService } from './delegations.service';
import { RequestTypes } from './request-types';
import { WorkflowUpkeep } from './workflow.upkeep';
import { WorkflowsController } from './workflows.controller';

/**
 * Approvals: each tenant's chains, requests, their steps and decisions, and the reminders and
 * escalations of steps left waiting (spec 5.9, 9.6, M15, decision D74).
 */
@Module({
  imports: [IamModule, TenantConfigModule],
  controllers: [ApprovalsController, WorkflowsController, DelegationsController],
  providers: [
    ApprovalsService,
    Approvers,
    ChainsService,
    DelegationsService,
    RequestTypes,
    WorkflowUpkeep,
  ],
  exports: [ApprovalsService, ChainsService, DelegationsService, RequestTypes],
})
export class WorkflowModule {}
