import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { AccountsModule } from '../accounts/accounts.module';
import { AuditModule } from '../audit/audit.module';
import { FinanceModule } from '../finance/finance.module';
import { OrdersModule } from '../orders/orders.module';
import { PlanningModule } from '../planning/planning.module';
import { ExpensesModule } from '../expenses/expenses.module';
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
import { ExpenseRegisterReport } from './expense-register';
import { LeaveRegisterReport } from './leave-register';
import { VisitComplianceReport } from './visit-compliance';
import { CoverageFrequencyReport } from './coverage-frequency';
import { GpsAuditTrailReport } from './gps-audit-trail';
import { LocationSummaryReport } from './location-summary';
import { OrdersRegisterReport } from './orders-register';
import { AccountStatementReport } from './account-statement';
import { AuditLogReport } from './audit-log-report';
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
    AccountsModule,
    AuditModule,
    FinanceModule,
    OrdersModule,
    PlanningModule,
    ExpensesModule,
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
    ExpenseRegisterReport,
    VisitComplianceReport,
    CoverageFrequencyReport,
    LocationSummaryReport,
    GpsAuditTrailReport,
    OrdersRegisterReport,
    AccountStatementReport,
    AuditLogReport,
  ],
})
export class ReportsModule {}
