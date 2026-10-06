import { Injectable } from '@nestjs/common';
import { CreateUserBody, type ProvisionTenantInput, type UserResult } from '@kshetra/shared';
import type { Template } from '@kshetra/templates';
import { Database, type TenantTx } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { SYSTEM } from '../iam/actor';
import { IamSetup } from '../iam/setup.service';
import { UsersService } from '../iam/users.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TerritoriesService } from '../territories/territories.service';

/**
 * A tenant's side of provisioning, in its cell (spec 5.14): the template's words, roles,
 * designations and geography levels, and the first admin, all in one transaction. When the
 * platform console arrives (module M22), it calls this through the cell's provisioning API.
 */
@Injectable()
export class CellSetup {
  constructor(
    private readonly database: Database,
    private readonly config: TenantConfigService,
    private readonly iam: IamSetup,
    private readonly territories: TerritoriesService,
    private readonly users: UsersService,
    private readonly outbox: Outbox,
  ) {}

  /** Applies a template to a tenant that has none yet. */
  async applyTemplate(tx: TenantTx, tenantId: string, template: Template): Promise<void> {
    await this.config.applyTemplate(tx, tenantId, { terminology: template.terminology });
    await this.iam.applyTemplate(tx, tenantId, {
      roles: template.roles,
      designations: template.designations,
    });
    await this.territories.applyLevels(tx, tenantId, template.geographyLevels);
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
