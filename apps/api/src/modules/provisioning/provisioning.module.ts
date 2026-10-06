import { Module } from '@nestjs/common';
import { DirectoryModule } from '../directory/directory.module';
import { IamModule } from '../iam/iam.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { TerritoriesModule } from '../territories/territories.module';
import { CellSetup } from './cell-setup.service';
import { TenantProvisioner } from './provisioner';

/**
 * Creating tenants (spec 5.14, module M22). The provisioning command uses it now; the platform
 * console will from phase 3.
 */
@Module({
  imports: [DirectoryModule, IamModule, TenantConfigModule, TerritoriesModule],
  providers: [CellSetup, TenantProvisioner],
  exports: [CellSetup, TenantProvisioner],
})
export class ProvisioningModule {}
