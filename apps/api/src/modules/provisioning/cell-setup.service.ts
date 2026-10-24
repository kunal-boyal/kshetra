import { Injectable } from '@nestjs/common';
import { CreateUserBody, type ProvisionTenantInput, type UserResult } from '@thelamp/shared';
import type { Template } from '@thelamp/templates';
import { SYSTEM_ACTOR } from '../../platform/audit';
import { Database, type TenantTx } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { AccountTypesService } from '../accounts/account-types.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import { HeldConfiguration } from '../configuration/held-configuration';
import { ChainsService } from '../workflow/chains.service';
import { AttendanceService } from '../field/attendance.service';
import { CalendarsService } from '../field/calendars.service';
import { LeaveTypesService } from '../leave/leave-types.service';
import { ExpensePoliciesService } from '../expenses/expense-policies.service';
import { FormsService } from '../forms/forms.service';
import { SYSTEM } from '../iam/actor';
import { IamSetup } from '../iam/setup.service';
import { ImportsService } from '../imports/imports.service';
import { templateImports } from '../imports/template-imports';
import { MetricsService } from '../metrics/metrics.service';
import { UsersService } from '../iam/users.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TerritoriesService } from '../territories/territories.service';

/**
 * A tenant's side of provisioning, in its cell (spec 5.14): the template's words, roles,
 * designations, geography levels, account types, catalogue settings, forms, metrics and settings,
 * with the approval chains and people policies kept for phase 2 (decision D66), and the first
 * admin, all in one transaction. When the platform console arrives (module M22), it calls this
 * through the cell's provisioning API.
 */
@Injectable()
export class CellSetup {
  constructor(
    private readonly database: Database,
    private readonly config: TenantConfigService,
    private readonly iam: IamSetup,
    private readonly territories: TerritoriesService,
    private readonly imports: ImportsService,
    private readonly accountTypes: AccountTypesService,
    private readonly catalogue: CatalogueService,
    private readonly forms: FormsService,
    private readonly attendance: AttendanceService,
    private readonly calendars: CalendarsService,
    private readonly leaveTypes: LeaveTypesService,
    private readonly expensePolicies: ExpensePoliciesService,
    private readonly metrics: MetricsService,
    private readonly users: UsersService,
    private readonly held: HeldConfiguration,
    private readonly chains: ChainsService,
    private readonly outbox: Outbox,
  ) {}

  /** Applies a template to a tenant that has none yet. */
  async applyTemplate(tx: TenantTx, tenantId: string, template: Template): Promise<void> {
    await this.config.applyTemplate(tx, tenantId, { terminology: template.terminology });
    await this.iam.applyTemplate(tx, tenantId, {
      roles: template.roles,
      designations: template.designations,
      userFields: template.userFields,
    });
    await this.territories.applyLevels(tx, tenantId, template.geographyLevels);
    await this.accountTypes.applyTemplate(tx, tenantId, template.accountTypes);
    await this.catalogue.applyTemplate(tx, tenantId, template.catalogue);
    await this.forms.applyTemplate(tx, tenantId, template.forms);
    await this.metrics.applyTemplate(tx, tenantId, template.metrics, template.score);
    await this.attendance.applyTemplate(tx, tenantId, template.people.attendance);
    await this.calendars.applyTemplate(tx, tenantId, template.people);
    await this.leaveTypes.applyTemplate(tx, tenantId, template.people?.leaveTypes);
    await this.expensePolicies.applyTemplate(tx, tenantId, template.people?.expensePolicies);
    await this.imports.applyTemplate(tx, tenantId, templateImports(template));
    await this.chains.applyTemplate(tx, tenantId, template.workflows);
    await this.held.save(tx, tenantId, { people: template.people }, null);
    if (template.settings && Object.keys(template.settings).length > 0) {
      await this.config.updateSettings(tx, tenantId, SYSTEM_ACTOR, template.settings);
    }
  }

  /**
   * Sets a new tenant up and adds its first admin, who holds the highest designation. The
   * `tenant.provisioned` event then opens the tenant in the directory.
   */
  async provision(
    tenantId: string,
    template: Template,
    input: ProvisionTenantInput,
  ): Promise<UserResult> {
    return this.database.forTenant(tenantId, async (tx) => {
      await this.applyTemplate(tx, tenantId, template);
      const [top] = [...template.designations].sort((a, b) => a.level - b.level);
      const admin = await this.users.create(
        tx,
        tenantId,
        SYSTEM,
        CreateUserBody.parse({
          code: input.admin.code,
          name: input.admin.name,
          phone: input.admin.phone,
          ...(input.admin.email ? { email: input.admin.email } : {}),
          designation: top!.key,
          role: 'tenant_admin',
        }),
      );
      await this.outbox.publish(tx, tenantId, 'tenant.provisioned', tenantId, {
        tenantId,
        templateKey: template.key,
        templateVersion: template.version,
        status: input.status,
      });
      return admin;
    });
  }
}
