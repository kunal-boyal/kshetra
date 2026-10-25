import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  IdParams,
  SupportEntryResult,
  SupportGrantList,
  SupportGrantQuery,
  SupportGrantResult,
  SupportRequestBody,
} from '@thelamp/shared';
import { CurrentStaff, ForStaff, type StaffAccess } from '../../platform/auth';
import { Contract } from '../../platform/routes';
import { SupportService } from './support.service';

/**
 * Support access in the platform console (module M22, decision D93): staff ask to enter a tenant,
 * open its portal under an approved grant, and end it; a vendor admin approves emergencies.
 */
@Controller('platform/v1/support-grants')
export class SupportConsoleController {
  constructor(private readonly support: SupportService) {}

  @ForStaff('platform.support.request')
  @Get()
  @Contract({
    tag: 'Platform console',
    summary: 'List support grants',
    query: SupportGrantQuery,
    response: SupportGrantList,
  })
  async list(@CurrentStaff() staff: StaffAccess, @Query() query: unknown) {
    return { items: await this.support.list(staff, SupportGrantQuery.parse(query)) };
  }

  @ForStaff('platform.support.request')
  @Post()
  @Contract({
    tag: 'Platform console',
    summary: 'Ask to enter a tenant for support',
    body: SupportRequestBody,
    response: SupportGrantResult,
  })
  request(@CurrentStaff() staff: StaffAccess, @Body() body: unknown) {
    return this.support.request(staff, SupportRequestBody.parse(body));
  }

  @ForStaff('platform.support.approve_emergency')
  @Post(':id/approve')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'Approve another staff member’s emergency access',
    params: IdParams,
    response: SupportGrantResult,
  })
  approve(@CurrentStaff() staff: StaffAccess, @Param() params: unknown) {
    return this.support.approveEmergency(staff, IdParams.parse(params).id);
  }

  @ForStaff('platform.support.request')
  @Post(':id/end')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'End support access, or withdraw a request',
    params: IdParams,
    response: SupportGrantResult,
  })
  end(@CurrentStaff() staff: StaffAccess, @Param() params: unknown) {
    return this.support.endForStaff(staff, IdParams.parse(params).id);
  }

  @ForStaff('platform.support.request')
  @Post(':id/enter')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'A one-time link into the tenant’s portal under the grant',
    params: IdParams,
    response: SupportEntryResult,
  })
  enter(@CurrentStaff() staff: StaffAccess, @Param() params: unknown) {
    return this.support.entry(staff, IdParams.parse(params).id);
  }
}
