import { Global, Module } from '@nestjs/common';
import { IamAccess } from './modules/iam/access.service';
import { IamAdmission } from './modules/iam/admission.service';
import { IamModule } from './modules/iam/iam.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { DirectoryMembers } from './modules/directory/members';
import { DirectoryTenants } from './modules/directory/tenants';
import { AccessResolver } from './platform/auth';
import { CellAdmission, MembershipSync, TenantDirectory } from './platform/planes';

/**
 * Connects the directory plane and the cell, which depend on each other only through the seams in
 * `platform/planes.ts` (spec 9.3). When the directory becomes its own service, these providers
 * become clients of the other side, and neither module changes.
 */
@Global()
@Module({
  imports: [DirectoryModule, IamModule],
  providers: [
    { provide: CellAdmission, useExisting: IamAdmission },
    { provide: MembershipSync, useExisting: DirectoryMembers },
    { provide: TenantDirectory, useExisting: DirectoryTenants },
    { provide: AccessResolver, useExisting: IamAccess },
  ],
  exports: [CellAdmission, MembershipSync, TenantDirectory, AccessResolver],
})
export class PlanesModule {}
