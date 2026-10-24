import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { FieldModule } from '../field/field.module';
import { FormsModule } from '../forms/forms.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { MetricsModule } from '../metrics/metrics.module';
import { PerformanceModule } from '../performance/performance.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TerritoriesModule } from '../territories/territories.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';
import { HeldConfiguration } from './held-configuration';

/**
 * Configuration export and import (M2, decision D66), and the configuration kept for modules
 * still to come. It changes configuration only through the modules that own it.
 */
@Module({
  imports: [
    LeaveModule,
    ExpensesModule,
    TenantConfigModule,
    IamModule,
    TerritoriesModule,
    AccountsModule,
    CatalogueModule,
    FormsModule,
    MetricsModule,
    PerformanceModule,
    FieldModule,
    ImportsModule,
    WorkflowModule,
  ],
  controllers: [ConfigurationController],
  providers: [ConfigurationService, HeldConfiguration],
  exports: [HeldConfiguration],
})
export class ConfigurationModule {}
