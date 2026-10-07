import { Module } from '@nestjs/common';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TenantScheduler } from './tenant-scheduler';

/** The scheduler process's work: interval schedules and moments of each tenant's day (spec 12.3). */
@Module({
  imports: [TenantConfigModule],
  providers: [TenantScheduler],
  exports: [TenantScheduler],
})
export class SchedulingModule {}
