import { Global, Module, type OnModuleInit } from '@nestjs/common';
import type { EventPayload } from '@kshetra/shared';
import { IamAccess } from './modules/iam/access.service';
import { IamAdmission } from './modules/iam/admission.service';
import { IamModule } from './modules/iam/iam.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { DirectoryMembers } from './modules/directory/members';
import { DirectoryTenants } from './modules/directory/tenants';
import { AccessResolver } from './platform/auth';
import { Outbox } from './platform/outbox';
import { CellAdmission, MembershipSync, TenantDirectory } from './platform/planes';

/**
 * Connects the directory plane and the cell, which depend on each other only through the seams in
 * `platform/planes.ts` (spec 9.3). When the directory becomes its own service, these providers
 * become clients of the other side, and neither module changes. The directory hears of user
 * changes through the cell's outbox, so a directory that is briefly away delays sign-in changes
 * instead of blocking them.
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
export class PlanesModule implements OnModuleInit {
  constructor(
    private readonly outbox: Outbox,
    private readonly members: MembershipSync,
    private readonly tenants: DirectoryTenants,
  ) {}

  onModuleInit(): void {
    // A tenant opens once its cell has applied the template and added the first admin.
    this.outbox.consume(['tenant.provisioned'], 'directory.tenant_status', async (event) => {
      const { tenantId, status } = event.payload as EventPayload<'tenant.provisioned'>;
      await this.tenants.setStatus(tenantId, status);
    });
    this.outbox.consume(
      ['user.created', 'user.updated', 'user.deactivated'],
      'directory.membership',
      async (event) => {
        const user = event.payload as EventPayload<'user.updated'>;
        await this.members.sync({
          tenantId: event.tenantId,
          userId: user.userId,
          phone: user.phone,
          active: user.status === 'active',
          authRevision: user.authRevision,
        });
      },
    );
  }
}
