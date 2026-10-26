import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  CloseDataRequestBody,
  DataRequestList,
  DataRequestQuery,
  DataRequestResult,
  IdParams,
  LogDataRequestBody,
  RaiseDataRequestBody,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { DataRequestsService } from './data-requests.service';

/**
 * Personal data requests (module M21, spec 13.3, decision D95): a person raises and follows their
 * own; the tenant's admins log them for people, prepare an access request's archive, and answer.
 */
@Controller('v1')
export class DataRequestsController {
  constructor(
    private readonly database: Database,
    private readonly requests: DataRequestsService,
  ) {}

  @Get('me/data-requests')
  @SignedIn()
  @Contract({
    tag: 'Data',
    summary: 'The caller’s own requests about their personal data',
    response: DataRequestList,
  })
  async mine(@CurrentAccess() access: Access) {
    return {
      items: await this.database.forTenant(access.tenantId, (tx) => this.requests.mine(tx, access)),
    };
  }

  @Post('me/data-requests')
  @SignedIn()
  @Contract({
    tag: 'Data',
    summary: 'Ask for a copy, a correction or the erasure of one’s own personal data',
    body: RaiseDataRequestBody,
    response: DataRequestResult,
  })
  raise(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = RaiseDataRequestBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.requests.raiseOwn(tx, access, input),
    );
  }

  @Get('data-requests')
  @Requires('settings.manage')
  @Contract({
    tag: 'Data',
    summary: 'Personal data requests: open by when due, or closed',
    query: DataRequestQuery,
    response: DataRequestList,
  })
  async list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const { status } = DataRequestQuery.parse(query);
    return {
      items: await this.database.forTenant(access.tenantId, (tx) =>
        this.requests.list(tx, access.tenantId, status),
      ),
    };
  }

  @Post('data-requests')
  @Requires('settings.manage')
  @Contract({
    tag: 'Data',
    summary: 'Log a personal data request someone made another way',
    body: LogDataRequestBody,
    response: DataRequestResult,
  })
  log(@CurrentAccess() access: Access, @Body() body: unknown) {
    const { userId, ...input } = LogDataRequestBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.requests.log(tx, access, userId, input),
    );
  }

  @Get('data-requests/:id')
  @Requires('settings.manage')
  @Contract({
    tag: 'Data',
    summary: 'A personal data request, with a day’s link to its archive while kept',
    params: IdParams,
    response: DataRequestResult,
  })
  get(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { id } = IdParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) => this.requests.get(tx, access, id));
  }

  @Post('data-requests/:id/archive')
  @HttpCode(200)
  @Requires('settings.manage')
  @Contract({
    tag: 'Data',
    summary: 'Prepare the signed archive of the person’s own data, for an access request',
    params: IdParams,
    response: DataRequestResult,
  })
  prepareArchive(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { id } = IdParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.requests.prepareArchive(tx, access, id),
    );
  }

  @Post('data-requests/:id/close')
  @HttpCode(200)
  @Requires('settings.manage')
  @Contract({
    tag: 'Data',
    summary: 'Answer a personal data request; completing an erasure erases the person’s data',
    params: IdParams,
    body: CloseDataRequestBody,
    response: DataRequestResult,
  })
  close(@CurrentAccess() access: Access, @Param() params: unknown, @Body() body: unknown) {
    const { id } = IdParams.parse(params);
    const input = CloseDataRequestBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.requests.close(tx, access, id, input),
    );
  }
}
