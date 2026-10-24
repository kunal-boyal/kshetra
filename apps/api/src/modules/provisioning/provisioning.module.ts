import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { ConfigurationModule } from '../configuration/configuration.module';
import { FieldModule } from '../field/field.module';
import { FormsModule } from '../forms/forms.module';
import { DirectoryModule } from '../directory/directory.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { MetricsModule } from '../metrics/metrics.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TerritoriesModule } from '../territories/territories.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { CellSetup } from './cell-setup.service';
import { TenantProvisioner } from './provisioner';

/**
 * Creating tenants (spec 5.14, module M22). The provisioning command uses it now; the platform
 * console will from phase 3.
 */
@Module({
  imports: [
    LeaveModule,
    DirectoryModule,
    IamModule,
    TenantConfigModule,
    TerritoriesModule,
    ImportsModule,
    AccountsModule,
    CatalogueModule,
    FormsModule,
    FieldModule,
    MetricsModule,
    ConfigurationModule,
    WorkflowModule,
  ],
  providers: [CellSetup, TenantProvisioner],
  exports: [CellSetup, TenantProvisioner],
})
export class ProvisioningModule {}
