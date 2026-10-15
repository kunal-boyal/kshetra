import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { MetricsModule } from '../metrics/metrics.module';
import { SyncModule } from '../sync/sync.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AccountPlansImport } from './account-plans.import';
import { AccountPlansService } from './account-plans.service';
import { PlanItemsSync } from './plan-items.sync';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';
import { PlanningUpkeep } from './planning.upkeep';
import { TargetsController } from './targets.controller';
import { TargetsImport } from './targets.import';
import { TargetsService } from './targets.service';

/** Routes, plan items and their approval, targets and account plans (M8, spec 5.8, 9.6 `planning`). */
@Module({
  imports: [
    IamModule,
    AccountsModule,
    TenantConfigModule,
    WorkflowModule,
    SyncModule,
    MetricsModule,
    ImportsModule,
  ],
  controllers: [PlanningController, TargetsController],
  providers: [
    PlanningService,
    PlanningUpkeep,
    PlanItemsSync,
    TargetsService,
    AccountPlansService,
    TargetsImport,
    AccountPlansImport,
  ],
  exports: [PlanningService, TargetsService],
})
export class PlanningModule {}
