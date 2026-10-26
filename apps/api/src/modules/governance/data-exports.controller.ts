import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ArchiveSigningKey,
  CreateDataExportBody,
  DataExportList,
  DataExportResult,
  IdParams,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { DataExportsService } from './data-exports.service';

/**
 * The tenant's data export (module M21, spec 13.3, decision D95), for its admins: asking for the
 * signed archive of everything the tenant holds, following it, downloading it, and the key that
 * checks its signature.
 */
@Controller('v1/data-exports')
export class DataExportsController {
  constructor(
    private readonly database: Database,
    private readonly exports: DataExportsService,
  ) {}

  @Get()
  @Requires('settings.manage')
  @Contract({ tag: 'Data', summary: 'The organisation’s data exports', response: DataExportList })
  async list(@CurrentAccess() access: Access) {
    return {
      items: await this.database.forTenant(access.tenantId, (tx) =>
        this.exports.list(tx, access.tenantId),
      ),
    };
  }

  @Post()
  @Requires('settings.manage')
  @Contract({
    tag: 'Data',
    summary: 'Ask for a signed archive of all the organisation’s data',
    body: CreateDataExportBody,
    response: DataExportResult,
  })
  create(@CurrentAccess() access: Access, @Body() body: unknown) {
    const { id } = CreateDataExportBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) => this.exports.create(tx, access, id));
  }

  @Get('signing-key')
  @Requires('settings.manage')
  @Contract({
    tag: 'Data',
    summary: 'The public key that checks an archive’s signature',
    response: ArchiveSigningKey,
  })
  signingKey() {
    return this.exports.signingKey();
  }

  @Get(':id')
  @Requires('settings.manage')
  @Contract({
    tag: 'Data',
    summary: 'A data export, with a day’s download link while it is kept',
    params: IdParams,
    response: DataExportResult,
  })
  get(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { id } = IdParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) => this.exports.get(tx, access, id));
  }
}
