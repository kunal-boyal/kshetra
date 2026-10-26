import { Global, Module } from '@nestjs/common';
import { StaffResolver } from '../../platform/auth';
import { ColumnCipher } from '../../platform/column-cipher';
import { DirectoryModule } from '../directory/directory.module';
import { ProvisioningModule } from '../provisioning/provisioning.module';
import { ConsoleSessionController } from './console-session.controller';
import { ConsoleTerminationController } from './console-termination.controller';
import { ConsoleTenantsController } from './console-tenants.controller';
import { ConsoleTenantsService } from './console-tenants.service';
import { StaffService } from './staff.service';
import { TenantTermination } from './tenant-termination';

/**
 * The platform console's API (module M22, decision D88): vendor staff and the tenants they look
 * after. It belongs to the directory plane and reaches the directory schema with the directory's
 * own connection; it gives the auth guard its check of staff tokens.
 */
@Global()
@Module({
  imports: [DirectoryModule, ProvisioningModule],
  controllers: [ConsoleSessionController, ConsoleTenantsController, ConsoleTerminationController],
  providers: [
    ColumnCipher,
    StaffService,
    ConsoleTenantsService,
    TenantTermination,
    { provide: StaffResolver, useExisting: StaffService },
  ],
  exports: [StaffResolver, StaffService, ColumnCipher],
})
export class ConsoleModule {}
