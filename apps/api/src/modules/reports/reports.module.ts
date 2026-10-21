import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { FormsModule } from '../forms/forms.module';
import { IamModule } from '../iam/iam.module';
import { MediaModule } from '../media/media.module';
import { MediaUrls } from '../media/media-urls';
import { PerformanceModule } from '../performance/performance.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TerritoriesModule } from '../territories/territories.module';
import { ActivityLogReport } from './activity-log';
import { AttendanceRegisterReport } from './attendance-register';
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
    FormsModule,
    PerformanceModule,
    TerritoriesModule,
    TenantConfigModule,
    MediaModule,
  ],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ExportsService,
    MediaUrls,
    ActivityLogReport,
    AttendanceRegisterReport,
    TargetAchievementReport,
  ],
})
export class ReportsModule {}
