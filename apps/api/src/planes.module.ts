import { Global, Module, type OnModuleInit } from '@nestjs/common';
import type { EventPayload } from '@thelamp/shared';
import { BillingModule } from './modules/billing/billing.module';
import type { Config } from './config';
import { EntitlementsService } from './modules/billing/entitlements.service';
import { LicenceEntitlements } from './modules/billing/licence-entitlements';
import { StatutoryRatesService } from './modules/billing/statutory-rates.service';
import { UsageService } from './modules/billing/usage.service';
import { IamAccess } from './modules/iam/access.service';
import { IamAdmission } from './modules/iam/admission.service';
import { IamContacts, IamPeopleEmails, IamPeopleNames } from './modules/iam/contacts';
import { IamSupportNotices } from './modules/iam/support-notices';
import { ApiClientsService } from './modules/iam/api-clients.service';
import { SupportService } from './modules/directory/support.service';
import { CellHealthService } from './modules/directory/cell-health.service';
import { IamModule } from './modules/iam/iam.module';
import { MeteringModule } from './modules/metering/metering.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CellSignedOutPhones } from './modules/notifications/signed-out-phones';
import { CellSeatCounts } from './modules/metering/seat-counts';
import { DirectoryModule } from './modules/directory/directory.module';
import { DirectoryMembers } from './modules/directory/members';
import { DirectoryPhoneSessions } from './modules/directory/phone-sessions';
import { SecondFactorService } from './modules/directory/second-factor.service';
import { DirectoryTenants } from './modules/directory/tenants';
import { CellTenantArchives } from './modules/governance/cell-tenant-archives';
import { GovernanceModule } from './modules/governance/governance.module';
import { TenantConfigModule } from './modules/tenant-config/tenant-config.module';
import { CellTenantModules } from './modules/tenant-config/tenant-modules';
import { AccessResolver } from './platform/auth';
import { Outbox } from './platform/outbox';
import { CONFIG } from './platform/tokens';
import {
  ApiClientCredentials,
  CellAdmission,
  CellHealthRecorder,
  Entitlements,
  MembershipSync,
  PeopleEmails,
  PeopleNames,
  PhoneSessions,
  SeatCounts,
  SecondFactors,
  SignedOutPhones,
  StatutoryRates,
  SupportGrants,
  SupportNotices,
  TenantArchives,
  TenantContacts,
  TenantDirectory,
  TenantModules,
  UsageRecorder,
} from './platform/planes';

/**
 * Connects the directory plane and the cell, which depend on each other only through the seams in
 * `platform/planes.ts` (spec 9.3). When the directory becomes its own service, these providers
 * become clients of the other side, and neither module changes. The directory hears of user
 * changes through the cell's outbox, so a directory that is briefly away delays sign-in changes
 * instead of blocking them.
 */
@Global()
@Module({
  imports: [
    DirectoryModule,
    IamModule,
    BillingModule,
    MeteringModule,
    GovernanceModule,
    NotificationsModule,
    TenantConfigModule,
  ],
  providers: [
    { provide: CellAdmission, useExisting: IamAdmission },
    { provide: MembershipSync, useExisting: DirectoryMembers },
    { provide: TenantDirectory, useExisting: DirectoryTenants },
    { provide: AccessResolver, useExisting: IamAccess },
    {
      // A dedicated install in licence mode takes its entitlements from the signed file (D90).
      provide: Entitlements,
      inject: [CONFIG, EntitlementsService],
      useFactory: (config: Config, service: EntitlementsService) =>
        config.LICENCE_FILE_PATH && config.LICENCE_PUBLIC_KEY
          ? new LicenceEntitlements(config.LICENCE_FILE_PATH, config.LICENCE_PUBLIC_KEY)
          : service,
    },
    { provide: UsageRecorder, useExisting: UsageService },
    { provide: SeatCounts, useExisting: CellSeatCounts },
    { provide: TenantContacts, useExisting: IamContacts },
    { provide: SecondFactors, useExisting: SecondFactorService },
    { provide: PeopleEmails, useExisting: IamPeopleEmails },
    { provide: PeopleNames, useExisting: IamPeopleNames },
    { provide: SupportNotices, useExisting: IamSupportNotices },
    { provide: SupportGrants, useExisting: SupportService },
    { provide: CellHealthRecorder, useExisting: CellHealthService },
    { provide: ApiClientCredentials, useExisting: ApiClientsService },
    { provide: TenantArchives, useExisting: CellTenantArchives },
    { provide: TenantModules, useExisting: CellTenantModules },
    { provide: StatutoryRates, useExisting: StatutoryRatesService },
    { provide: PhoneSessions, useExisting: DirectoryPhoneSessions },
    { provide: SignedOutPhones, useExisting: CellSignedOutPhones },
  ],
  exports: [
    CellAdmission,
    MembershipSync,
    TenantDirectory,
    AccessResolver,
    Entitlements,
    UsageRecorder,
    SeatCounts,
    TenantContacts,
    SecondFactors,
    PeopleEmails,
    PeopleNames,
    SupportNotices,
    SupportGrants,
    CellHealthRecorder,
    ApiClientCredentials,
    TenantArchives,
    TenantModules,
    StatutoryRates,
    PhoneSessions,
    SignedOutPhones,
  ],
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
    this.outbox.consume(['user.erased'], 'directory.forget', async (event) => {
      const { userId } = event.payload as EventPayload<'user.erased'>;
      await this.members.forget(event.tenantId, userId);
    });
  }
}
