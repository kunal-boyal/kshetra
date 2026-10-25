import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiClientList,
  ApiClientResult,
  ApiClientSecret,
  CreateApiClientBody,
  IdParams,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { ApiClientsService } from './api-clients.service';

/**
 * The tenant's API clients (spec 11.2, module M20, decision D94), for holders of
 * `api_client.manage`: listing them, making one with its scopes, rotating a secret and revoking a
 * client. A secret is shown once, when it is made.
 */
@Controller('v1/api-clients')
export class ApiClientsController {
  constructor(
    private readonly database: Database,
    private readonly clients: ApiClientsService,
  ) {}

  @Get()
  @Requires('api_client.manage')
  @Contract({ tag: 'Integrations', summary: 'List API clients', response: ApiClientList })
  async list(@CurrentAccess() access: Access) {
    return {
      items: await this.database.forTenant(access.tenantId, (tx) =>
        this.clients.list(tx, access.tenantId),
      ),
    };
  }

  @Post()
  @Requires('api_client.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Make an API client; its secret is shown once',
    body: CreateApiClientBody,
    response: ApiClientSecret,
  })
  create(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = CreateApiClientBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) => this.clients.create(tx, access, input));
  }

  @Post(':id/rotate')
  @HttpCode(200)
  @Requires('api_client.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Give an API client a new secret, shown once; the old one stops working',
    params: IdParams,
    response: ApiClientSecret,
  })
  rotate(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { id } = IdParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) => this.clients.rotate(tx, access, id));
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @Requires('api_client.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Revoke an API client for good',
    params: IdParams,
    response: ApiClientResult,
  })
  revoke(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { id } = IdParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) => this.clients.revoke(tx, access, id));
  }
}
