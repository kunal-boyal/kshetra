import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  CreatePlanBody,
  PlanBody,
  PlanIdParams,
  PlanListResult,
  PlanResult,
  TenantEntitlements,
  TenantIdParams,
  TenantPlanBody,
  TenantUsageResult,
  UsageQuery,
} from '@thelamp/shared';
import { CurrentStaff, ForStaff, type StaffAccess } from '../../platform/auth';
import { Contract } from '../../platform/routes';
import { EntitlementsService } from './entitlements.service';
import { PlansService } from './plans.service';
import { UsageService } from './usage.service';

/**
 * Plans, entitlements and usage in the platform console (modules M22 and M23, decision D89). Any
 * staff member reads them; changing plans and a tenant's plan needs `platform.plan.manage`.
 */
@Controller('platform/v1')
export class BillingController {
  constructor(
    private readonly plans: PlansService,
    private readonly entitlements: EntitlementsService,
    private readonly usage: UsageService,
  ) {}

  @ForStaff()
  @Get('plans')
  @Contract({ tag: 'Platform console', summary: 'List plans', response: PlanListResult })
  async list() {
    return { items: await this.plans.list() };
  }

  @ForStaff('platform.plan.manage')
  @Post('plans')
  @HttpCode(201)
  @Contract({
    tag: 'Platform console',
    summary: 'Add a plan',
    body: CreatePlanBody,
    response: PlanResult,
  })
  create(@CurrentStaff() staff: StaffAccess, @Body() body: unknown) {
    return this.plans.create(staff, CreatePlanBody.parse(body));
  }

  @ForStaff('platform.plan.manage')
  @Put('plans/:id')
  @Contract({
    tag: 'Platform console',
    summary: 'Change a plan; its tenants follow at once',
    params: PlanIdParams,
    body: PlanBody,
    response: PlanResult,
  })
  update(@CurrentStaff() staff: StaffAccess, @Param() params: unknown, @Body() body: unknown) {
    return this.plans.update(staff, PlanIdParams.parse(params).id, PlanBody.parse(body));
  }

  @ForStaff()
  @Get('tenants/:id/entitlements')
  @Contract({
    tag: 'Platform console',
    summary: "A tenant's plan, extra modules and limits",
    params: TenantIdParams,
    response: TenantEntitlements,
  })
  detail(@Param() params: unknown) {
    return this.entitlements.detail(TenantIdParams.parse(params).id);
  }

  @ForStaff('platform.plan.manage')
  @Put('tenants/:id/plan')
  @Contract({
    tag: 'Platform console',
    summary: "Set a tenant's plan, extra modules and limits",
    params: TenantIdParams,
    body: TenantPlanBody,
    response: TenantEntitlements,
  })
  setPlan(@CurrentStaff() staff: StaffAccess, @Param() params: unknown, @Body() body: unknown) {
    return this.entitlements.set(
      staff,
      TenantIdParams.parse(params).id,
      TenantPlanBody.parse(body),
    );
  }

  @ForStaff()
  @Get('tenants/:id/usage')
  @Contract({
    tag: 'Platform console',
    summary: "A tenant's metered usage by month",
    params: TenantIdParams,
    query: UsageQuery,
    response: TenantUsageResult,
  })
  tenantUsage(@Param() params: unknown, @Query() query: unknown) {
    return this.usage.forTenant(TenantIdParams.parse(params).id, UsageQuery.parse(query).months);
  }
}
