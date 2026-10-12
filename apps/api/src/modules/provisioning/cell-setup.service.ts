import { Injectable } from '@nestjs/common';
import { CreateUserBody, type ProvisionTenantInput, type UserResult } from '@kshetra/shared';
import type { Template } from '@kshetra/templates';
import { Database, type TenantTx } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { AccountTypesService } from '../accounts/account-types.service';
import { SYSTEM } from '../iam/actor';
import { IamSetup } from '../iam/setup.service';
import { ImportsService } from '../imports/imports.service';
import { UsersService } from '../iam/users.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TerritoriesService } from '../territories/territories.service';

/**
 * A tenant's side of provisioning, in its cell (spec 5.14): the template's words, roles,
 * designations, geography levels and account types, and the first admin, all in one transaction. When the
 * platform console arrives (module M22), it calls this through the cell's provisioning API.
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
    private readonly users: UsersService,
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
    await this.imports.applyTemplate(tx, tenantId, templateImports(template));
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

/** A template's import aliases by target: `users`, `items`, and `accounts:<type>` for each type. */
export function templateImports(template: Template) {
  const { users, accounts, items } = template.imports;
  return {
    ...(users ? { users } : {}),
    ...(items ? { items } : {}),
    ...Object.fromEntries(
      Object.entries(accounts ?? {}).map(([type, target]) => [`accounts:${type}`, target]),
    ),
  };
}
