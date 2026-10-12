import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { RequestTypes } from './request-types';

/** Approvals: requests, their steps and decisions (spec 5.9, 9.6, M15). */
@Module({
  imports: [IamModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, RequestTypes],
  exports: [ApprovalsService, RequestTypes],
})
export class WorkflowModule {}
