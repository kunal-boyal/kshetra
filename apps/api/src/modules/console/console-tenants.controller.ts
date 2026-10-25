import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  CellListResult,
  ConsoleTenant,
  ConsoleTenantList,
  ConsoleTenantQuery,
  CreateTenantBody,
  normalisePhone,
  SecondFactorResetBody,
  SecondFactorResetResult,
  SuspendTenantBody,
  TemplateListResult,
  TenantIdParams,
} from '@thelamp/shared';
import { CurrentStaff, ForStaff, type StaffAccess } from '../../platform/auth';
import { Contract } from '../../platform/routes';
import { AppError } from '@thelamp/shared';
import { SecondFactorService } from '../directory/second-factor.service';
import { DirectoryDatabase } from '../directory/directory.database';
import { PlatformAudit } from '../directory/platform-audit';
import { ConsoleTenantsService } from './console-tenants.service';

/**
 * Tenants in the platform console (module M22, decision D88). Any staff member sees them;
 * creating, suspending and reactivating need `platform.tenant.manage`.
 */
@Controller('platform/v1')
export class ConsoleTenantsController {
  constructor(
    private readonly tenants: ConsoleTenantsService,
    private readonly secondFactors: SecondFactorService,
    private readonly directory: DirectoryDatabase,
    private readonly audit: PlatformAudit,
  ) {}

  @ForStaff()
  @Get('tenants')
  @Contract({
    tag: 'Platform console',
    summary: 'List tenants',
    query: ConsoleTenantQuery,
    response: ConsoleTenantList,
  })
  list(@Query() query: unknown) {
    return this.tenants.list(ConsoleTenantQuery.parse(query));
  }

  @ForStaff()
  @Get('tenants/:id')
  @Contract({
    tag: 'Platform console',
    summary: 'Read a tenant',
    params: TenantIdParams,
    response: ConsoleTenant,
  })
  get(@Param() params: unknown) {
    return this.tenants.get(TenantIdParams.parse(params).id);
  }

  @ForStaff('platform.tenant.manage')
  @Post('tenants')
  @HttpCode(201)
  @Contract({
    tag: 'Platform console',
    summary: 'Create a tenant from a template, with its first admin',
    body: CreateTenantBody,
    response: ConsoleTenant,
  })
  create(@CurrentStaff() staff: StaffAccess, @Body() body: unknown) {
    return this.tenants.create(staff, CreateTenantBody.parse(body));
  }

  @ForStaff('platform.tenant.manage')
  @Post('tenants/:id/suspend')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'Suspend a tenant: nobody signs in until it is reactivated',
    params: TenantIdParams,
    body: SuspendTenantBody,
    response: ConsoleTenant,
  })
  suspend(@CurrentStaff() staff: StaffAccess, @Param() params: unknown, @Body() body: unknown) {
    const { reason } = SuspendTenantBody.parse(body);
    return this.tenants.suspend(staff, TenantIdParams.parse(params).id, reason);
  }

  @ForStaff('platform.tenant.manage')
  @Post('tenants/:id/reactivate')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'Reactivate a suspended tenant',
    params: TenantIdParams,
    response: ConsoleTenant,
  })
  reactivate(@CurrentStaff() staff: StaffAccess, @Param() params: unknown) {
    return this.tenants.reactivate(staff, TenantIdParams.parse(params).id);
  }

  @ForStaff()
  @Get('templates')
  @Contract({
    tag: 'Platform console',
    summary: 'The industry templates a tenant can start from',
    response: TemplateListResult,
  })
  templates() {
    return { items: this.tenants.templates() };
  }

  @ForStaff()
  @Get('cells')
  @Contract({
    tag: 'Platform console',
    summary: 'The cells tenants can live in',
    response: CellListResult,
  })
  async cells() {
    return { items: await this.tenants.cells() };
  }

  @ForStaff('platform.support.request')
  @Post('tenants/:id/second-factor-resets')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: "Remove a tenant member's authenticator, found by their number",
    params: TenantIdParams,
    body: SecondFactorResetBody,
    response: SecondFactorResetResult,
  })
  async resetSecondFactor(
    @CurrentStaff() staff: StaffAccess,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    const tenantId = TenantIdParams.parse(params).id;
    const { phone, reason } = SecondFactorResetBody.parse(body);
    const e164 = normalisePhone(phone);
    const userId = e164 ? await this.secondFactors.userByPhone(tenantId, e164) : undefined;
    if (!userId) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', [
        { path: 'phone', issue: 'Nobody in this tenant has this number' },
      ]);
    }
    const removed = await this.secondFactors.reset(tenantId, userId);
    await this.directory.db.transaction((tx) =>
      this.audit.record(tx, staff, 'tenant.second_factor_reset', 'tenant', tenantId, {
        userId,
        removed,
        reason,
      }),
    );
    return { removed };
  }
}
