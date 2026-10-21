import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { FieldModule } from '../field/field.module';
import { IamModule } from '../iam/iam.module';
import { MetricsModule } from '../metrics/metrics.module';
import { PlanningModule } from '../planning/planning.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { MetricsEngine } from './metrics-engine';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';
import { PerformanceUpkeep } from './performance.upkeep';

/**
 * The metric engine, scores and ranks (M9, spec 12.5): the computing half of spec 9.6's `metrics`
 * module, apart from the definitions so planning can read those without a cycle (decision D56).
 */
@Module({
  imports: [
    IamModule,
    AccountsModule,
    FieldModule,
    PlanningModule,
    MetricsModule,
    TenantConfigModule,
  ],
  controllers: [PerformanceController],
  providers: [MetricsEngine, PerformanceService, PerformanceUpkeep],
  exports: [MetricsEngine, PerformanceService],
})
export class PerformanceModule {}
