import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
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
  ErpUploadQuery,
  ErpFileLink,
  ErpRunParams,
  TallyOrdersFileBody,
  AppError,
  IdParams,
  SapConnectBody,
  TallyConnectBody,
} from '@thelamp/shared';
import { createHash } from 'node:crypto';
import { type Access, CurrentAccess, InModule, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { ErpConnectionsService } from './erp-connections.service';

/**
 * ERP connections (spec 11.2, module M20, decision D129), for holders of `erp.manage`: connecting
 * Zoho Books through its OAuth, SAP Business One by its Service Layer, or Tally by its files; the
 * organisation, the mappings, Sync now or a Tally file uploaded, the runs and disconnecting. Zoho
 * sends the browser back to the portal, which hands the code to `complete`, so no route here is
 * public.
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

  // Checked by signing in to the books before anything is kept; sending it again changes nothing
  // more than the details sent.
  @Post('sap-b1')
  @HttpCode(200)
  @Requires('erp.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Connect SAP Business One, or change its Service Layer, company, user or password',
    body: SapConnectBody,
    response: ErpConnectionResult,
  })
  connectSap(@CurrentAccess() access: Access, @Body() body: unknown) {
    return this.connections.connectSap(access, SapConnectBody.parse(body));
  }

  // Connecting again changes nothing but the status, so a resend is harmless.
  @Post('tally')
  @HttpCode(200)
  @Requires('erp.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Connect Tally, whose records come in the files an admin uploads',
    body: TallyConnectBody,
    response: ErpConnectionResult,
  })
  connectTally(@CurrentAccess() access: Access, @Body() body: unknown) {
    TallyConnectBody.parse(body ?? {});
    return this.connections.connectTally(access);
  }

  @Post(':id/uploads')
  @HttpCode(202)
  @Requires('erp.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Upload a file exported from Tally (masters or the Day Book, XML) to read',
    params: IdParams,
    query: ErpUploadQuery,
    response: ErpRunResult,
    idempotencyKey: true,
    headers: [
      {
        name: 'Content-Type',
        description: 'application/xml, text/xml or application/octet-stream',
      },
    ],
  })
  async upload(
    @CurrentAccess() access: Access,
    @Param() params: unknown,
    @Query() query: unknown,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const { id } = IdParams.parse(params);
    const { name } = ErpUploadQuery.parse(query);
    if (!(body instanceof Uint8Array)) {
      throw new AppError('VALIDATION', 'Send the file itself as the body.', [
        { path: 'body', issue: 'Send the file with Content-Type application/xml' },
      ]);
    }
    const sha256 = createHash('sha256').update(body).digest('hex');
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/erp-connections/{id}/uploads', by: access.userId, id, sha256 },
        async () => ({
          status: 202,
          body: await this.connections.upload(tx, access, id, body, name ?? 'tally.xml'),
        }),
      ),
    );
    return result.body;
  }

  // One run at a time; a resend while the first is made is refused, never a second file.
  @Post(':id/orders-file')
  @HttpCode(202)
  @Requires('erp.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Make a Tally file of the accepted orders waiting, or of an earlier file’s again',
    params: IdParams,
    body: TallyOrdersFileBody,
    response: ErpRunResult,
  })
  ordersFile(@CurrentAccess() access: Access, @Param() params: unknown, @Body() body: unknown) {
    const { id } = IdParams.parse(params);
    const { again } = TallyOrdersFileBody.parse(body ?? {});
    return this.connections.requestOrdersFile(access, id, again ?? null);
  }

  @Get(':id/runs/:runId/file')
  @Requires('erp.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'A short-lived link to save a Tally orders file, for 7 days after it was made',
    params: ErpRunParams,
    response: ErpFileLink,
  })
  file(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { id, runId } = ErpRunParams.parse(params);
    return this.connections.fileLink(access, id, runId);
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
