import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ConsoleDataExportBody,
  ConsoleTenant,
  DataExportList,
  DataExportResult,
  TenantExportParams,
  TenantIdParams,
  TerminateTenantBody,
} from '@thelamp/shared';
import { CurrentStaff, ForStaff, type StaffAccess } from '../../platform/auth';
import { Contract } from '../../platform/routes';
import { ConsoleTenantsService } from './console-tenants.service';
import { TenantTermination } from './tenant-termination';

/**
 * Terminating a tenant in the console (module M22, decision D95), for holders of
 * `platform.tenant.manage`: terminating a suspended tenant, undoing it within 30 days, and the
 * tenant's exports, with a day's link to send the customer.
 */
@Controller('platform/v1')
export class ConsoleTerminationController {
  constructor(
    private readonly tenants: ConsoleTenantsService,
    private readonly termination: TenantTermination,
  ) {}

  @ForStaff('platform.tenant.manage')
  @Post('tenants/:id/terminate')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'Terminate a suspended tenant: a final export now, its data deleted in 30 days',
    params: TenantIdParams,
    body: TerminateTenantBody,
    response: ConsoleTenant,
  })
  async terminate(
    @CurrentStaff() staff: StaffAccess,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    const { id } = TenantIdParams.parse(params);
    await this.termination.terminate(staff, id, TerminateTenantBody.parse(body));
    return this.tenants.get(id);
  }

  @ForStaff('platform.tenant.manage')
  @Post('tenants/:id/undo-termination')
  @HttpCode(200)
  @Contract({
    tag: 'Platform console',
    summary: 'Undo a termination before the data is deleted: the tenant is suspended again',
    params: TenantIdParams,
    response: ConsoleTenant,
  })
  async undo(@CurrentStaff() staff: StaffAccess, @Param() params: unknown) {
    const { id } = TenantIdParams.parse(params);
    await this.termination.undo(staff, id);
    return this.tenants.get(id);
  }

  @ForStaff('platform.tenant.manage')
  @Get('tenants/:id/data-exports')
  @Contract({
    tag: 'Platform console',
    summary: 'A tenant’s data exports',
    params: TenantIdParams,
    response: DataExportList,
  })
  async exports(@Param() params: unknown) {
    return { items: await this.termination.exports(TenantIdParams.parse(params).id) };
  }

  @ForStaff('platform.tenant.manage')
  @Post('tenants/:id/data-exports')
  @Contract({
    tag: 'Platform console',
    summary: 'Ask for a signed archive of a tenant’s data',
    params: TenantIdParams,
    body: ConsoleDataExportBody,
    response: DataExportResult,
  })
  requestExport(
    @CurrentStaff() staff: StaffAccess,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    const { id } = TenantIdParams.parse(params);
    return this.termination.requestExport(staff, id, ConsoleDataExportBody.parse(body).id);
  }

  @ForStaff('platform.tenant.manage')
  @Get('tenants/:id/data-exports/:exportId')
  @Contract({
    tag: 'Platform console',
    summary: 'A tenant’s data export, with a day’s link to send the customer',
    params: TenantExportParams,
    response: DataExportResult,
  })
  readExport(@CurrentStaff() staff: StaffAccess, @Param() params: unknown) {
    const { id, exportId } = TenantExportParams.parse(params);
    return this.termination.readExport(staff, id, exportId);
  }
}
