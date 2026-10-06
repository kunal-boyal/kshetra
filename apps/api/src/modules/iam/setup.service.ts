import { Injectable } from '@nestjs/common';
import type { DesignationDefinition, RoleDefinition } from '@kshetra/shared';
import type { TenantTx } from '../../platform/database';
import { SYSTEM } from './actor';
import { DesignationsService } from './designations.service';
import { RolesService } from './roles.service';

/** A new tenant's roles and designations, from its industry template (spec 5.14). */
@Injectable()
export class IamSetup {
  constructor(
    private readonly roles: RolesService,
    private readonly designations: DesignationsService,
  ) {}

  async applyTemplate(
    tx: TenantTx,
    tenantId: string,
    template: {
      roles: readonly RoleDefinition[];
      designations: readonly DesignationDefinition[];
    },
  ): Promise<void> {
    for (const role of template.roles) await this.roles.create(tx, tenantId, SYSTEM, role);
    for (const designation of template.designations) {
      await this.designations.create(tx, tenantId, SYSTEM, designation);
    }
  }
}
