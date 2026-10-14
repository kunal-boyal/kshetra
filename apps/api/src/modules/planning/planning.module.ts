import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { IamModule } from '../iam/iam.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';
import { PlanningUpkeep } from './planning.upkeep';

/** Routes, plan items and their approval (M8, spec 9.6 `planning`). */
@Module({
  imports: [IamModule, AccountsModule, TenantConfigModule, WorkflowModule],
  controllers: [PlanningController],
  providers: [PlanningService, PlanningUpkeep],
  exports: [PlanningService],
})
export class PlanningModule {}
