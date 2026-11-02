import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  ErpCompleteBody,
  ErpConnectionResult,
  ErpOrganizationBody,
  ErpProvidersResult,
  ErpRunList,
  ErpRunResult,
  ErpSettings,
  ErpStartBody,
  ErpStartResult,
  IdParams,
} from '@thelamp/shared';
import { type Access, CurrentAccess, InModule, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { ErpConnectionsService } from './erp-connections.service';

/**
 * ERP connections (spec 11.2, module M20, decision D129), for holders of `erp.manage`: connecting
 * Zoho Books through its OAuth, the organisation, the mappings, Sync now, the runs and
 * disconnecting. Zoho sends the browser back to the portal, which hands the code to `complete`,
 * so no route here is public.
 */
@Controller('v1/erp-connections')
@InModule('integrations')
export class ErpController {
  constructor(
    private readonly database: Database,
    private readonly connections: ErpConnectionsService,
  ) {}

  @Get()
  @Requires('erp.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'The ERPs this server can connect, and the connection',
    response: ErpProvidersResult,
  })
  providers(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, (tx) =>
      this.connections.providers(tx, access.tenantId),
    );
  }

  @Post('zoho/start')
  @HttpCode(200)
  @Requires('erp.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Where to send the browser to connect Zoho Books',
    body: ErpStartBody,
    response: ErpStartResult,
  })
  start(@CurrentAccess() access: Access, @Body() body: unknown) {
    return this.connections.start(access, ErpStartBody.parse(body).region);
  }

  // The state Zoho returns is spent here once, so a resent request can't connect twice.
  @Post('zoho/complete')
  @HttpCode(200)
  @Requires('erp.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Finish connecting Zoho Books with what it sent the browser back with',
    body: ErpCompleteBody,
    response: ErpConnectionResult,
  })
  complete(@CurrentAccess() access: Access, @Body() body: unknown) {
    return this.connections.complete(access, ErpCompleteBody.parse(body));
  }

  @Put(':id/organization')
  @Requires('erp.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Choose the organisation in the books to connect',
    params: IdParams,
    body: ErpOrganizationBody,
    response: ErpConnectionResult,
  })
  organization(@CurrentAccess() access: Access, @Param() params: unknown, @Body() body: unknown) {
    const { id } = IdParams.parse(params);
    return this.connections.chooseOrganization(
      access,
      id,
      ErpOrganizationBody.parse(body).organizationId,
    );
  }

  @Put(':id/settings')
  @Requires('erp.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Change what the connection reads and how',
    params: IdParams,
    body: ErpSettings,
    response: ErpConnectionResult,
  })
  settings(@CurrentAccess() access: Access, @Param() params: unknown, @Body() body: unknown) {
    const { id } = IdParams.parse(params);
    return this.connections.updateSettings(access, id, body);
  }

  @Post(':id/disconnect')
  @HttpCode(200)
  @Requires('erp.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Disconnect the ERP; its links stay for connecting again',
    params: IdParams,
    response: ErpConnectionResult,
  })
  disconnect(@CurrentAccess() access: Access, @Param() params: unknown) {
    return this.connections.disconnect(access, IdParams.parse(params).id);
  }

  @Get(':id/runs')
  @Requires('erp.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'The connection’s latest runs, newest first',
    params: IdParams,
    response: ErpRunList,
  })
  runs(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { id } = IdParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.connections.runs(tx, access.tenantId, id),
    );
  }

  // One run at a time: asking while one runs answers that one, so a resend starts nothing more.
  @Post(':id/runs')
  @HttpCode(202)
  @Requires('erp.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Read the books now',
    params: IdParams,
    response: ErpRunResult,
  })
  syncNow(@CurrentAccess() access: Access, @Param() params: unknown) {
    return this.connections.requestRun(access, IdParams.parse(params).id);
  }
}
