import { Module } from '@nestjs/common';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { TargetPeriods } from './target-periods';

/** Metric definitions (spec 5.7, 9.6 `metrics`) and the periods targets count over (D108). */
@Module({
  imports: [TenantConfigModule],
  controllers: [MetricsController],
  providers: [MetricsService, TargetPeriods],
  exports: [MetricsService, TargetPeriods],
})
export class MetricsModule {}
