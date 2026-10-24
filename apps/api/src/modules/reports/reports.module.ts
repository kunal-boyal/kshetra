import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { FieldModule } from '../field/field.module';
import { FormsModule } from '../forms/forms.module';
import { IamModule } from '../iam/iam.module';
import { MediaModule } from '../media/media.module';
import { MediaUrls } from '../media/media-urls';
import { PerformanceModule } from '../performance/performance.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TerritoriesModule } from '../territories/territories.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { ActivityLogReport } from './activity-log';
import { AttendanceRegisterReport } from './attendance-register';
import { LeaveRegisterReport } from './leave-register';
import { DashboardService } from './dashboard.service';
import { ExportsService } from './exports.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { TargetAchievementReport } from './target-achievement';

/**
 * Reports and exports (spec 9.6, M18, decision D62): reads over the records other modules own,
 * through their services, and export files kept in the media module.
 */
@Module({
  imports: [
    IamModule,
    FieldModule,
    LeaveModule,
    FormsModule,
    PerformanceModule,
    TerritoriesModule,
    TenantConfigModule,
    MediaModule,
    WorkflowModule,
  ],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ExportsService,
    DashboardService,
    MediaUrls,
    ActivityLogReport,
    AttendanceRegisterReport,
    TargetAchievementReport,
    LeaveRegisterReport,
  ],
})
export class ReportsModule {}
