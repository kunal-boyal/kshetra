import { Module } from '@nestjs/common';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { CellHealthReporter } from './cell-health-reporter';
import { TenantScheduler } from './tenant-scheduler';

/**
 * The scheduler process's work: interval schedules and moments of each tenant's day (spec 12.3),
 * and reporting the cell's health each minute (decision D93).
 */
@Module({
  imports: [TenantConfigModule],
  providers: [TenantScheduler, CellHealthReporter],
  exports: [TenantScheduler, CellHealthReporter],
})
export class SchedulingModule {}
