import { Injectable } from '@nestjs/common';
import type { CustomField } from '@kshetra/forms';
import type { DesignationDefinition, RoleDefinition } from '@kshetra/shared';
import type { TenantTx } from '../../platform/database';
import { SYSTEM } from './actor';
import { DesignationsService } from './designations.service';
import { RolesService } from './roles.service';
import { UserFieldsService } from './user-fields.service';

/** A new tenant's roles, designations and custom user fields, from its template (spec 5.14). */
@Injectable()
export class IamSetup {
  constructor(
    private readonly roles: RolesService,
    private readonly designations: DesignationsService,
    private readonly userFields: UserFieldsService,
  ) {}

  async applyTemplate(
    tx: TenantTx,
    tenantId: string,
    template: {
      roles: readonly RoleDefinition[];
      designations: readonly DesignationDefinition[];
      userFields?: readonly CustomField[];
    },
  ): Promise<void> {
    for (const role of template.roles) await this.roles.create(tx, tenantId, SYSTEM, role);
    for (const designation of template.designations) {
      await this.designations.create(tx, tenantId, SYSTEM, designation);
    }
    if (template.userFields && template.userFields.length > 0) {
      await this.userFields.replace(tx, tenantId, SYSTEM, { fields: [...template.userFields] });
    }
  }
}
