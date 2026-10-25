import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  type AuditAction,
  IdParams,
  SupportDecisionBody,
  SupportGrantList,
  SupportGrantResult,
} from '@thelamp/shared';
import { AuditLog, userActor } from '../../platform/audit';
import { type Access, CurrentAccess, Requires, WhileReadOnly } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { SupportService } from './support.service';

/**
 * Vendor support's access to the organisation, as its admins see it in Settings (module M22,
 * decision D93): requests to approve or decline, grants open now to end, and those gone. A
 * tenant that may only read can still decide, as support may be how it gets help.
 */
@Controller('v1/support-grants')
export class SupportSettingsController {
  constructor(
    private readonly support: SupportService,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  @Get()
  @Requires('settings.manage')
  @Contract({
    tag: 'Settings',
    summary: 'Vendor support’s requests and access to the organisation',
    response: SupportGrantList,
  })
  async list(@CurrentAccess() access: Access) {
    return { items: await this.support.forTenant(access.tenantId) };
  }

  @Post(':id/decision')
  @HttpCode(200)
  @Requires('settings.manage')
  @WhileReadOnly()
  @Contract({
    tag: 'Settings',
    summary: 'Approve or decline vendor support’s request',
    params: IdParams,
    body: SupportDecisionBody,
    response: SupportGrantResult,
  })
  async decide(@CurrentAccess() access: Access, @Param() params: unknown, @Body() body: unknown) {
    const id = IdParams.parse(params).id;
    const decision = SupportDecisionBody.parse(body);
    const change = await this.support.decide(access, id, decision);
    return this.record(access, decision.approve ? 'support.approved' : 'support.declined', change);
  }

  @Post(':id/end')
  @HttpCode(200)
  @Requires('settings.manage')
  @WhileReadOnly()
  @Contract({
    tag: 'Settings',
    summary: 'End vendor support’s access, or withdraw its request',
    params: IdParams,
    response: SupportGrantResult,
  })
  async end(@CurrentAccess() access: Access, @Param() params: unknown) {
    const change = await this.support.endForTenant(access, IdParams.parse(params).id);
    return this.record(access, 'support.ended', change);
  }

  private async record(
    access: Access,
    action: AuditAction,
    change: { before: SupportGrantResult; after: SupportGrantResult },
  ): Promise<SupportGrantResult> {
    await this.database.forTenant(access.tenantId, (tx) =>
      this.audit.record(tx, access.tenantId, userActor(access), {
        action,
        target: { type: 'support_grant', id: change.after.id },
        before: change.before,
        after: change.after,
      }),
    );
    return change.after;
  }
}
