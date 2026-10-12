import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { DirectoryModule } from '../directory/directory.module';
import { IamModule } from '../iam/iam.module';
import { ImportsModule } from '../imports/imports.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TerritoriesModule } from '../territories/territories.module';
import { CellSetup } from './cell-setup.service';
import { TenantProvisioner } from './provisioner';

/**
 * Creating tenants (spec 5.14, module M22). The provisioning command uses it now; the platform
 * console will from phase 3.
 */
@Module({
  imports: [
    DirectoryModule,
    IamModule,
    TenantConfigModule,
    TerritoriesModule,
    ImportsModule,
    AccountsModule,
  ],
  providers: [CellSetup, TenantProvisioner],
  exports: [CellSetup, TenantProvisioner],
})
export class ProvisioningModule {}
