import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  CreateRoleBody,
  IdParams,
  RoleListResult,
  RoleResult,
  UpdateRoleBody,
} from '@kshetra/shared';
import { type Access, CurrentAccess, Requires, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from './actor';
import { RolesService } from './roles.service';

/** Roles (spec 11.2, People group). */
@Controller('v1/roles')
export class RolesController {
  constructor(
    private readonly database: Database,
    private readonly roles: RolesService,
  ) {}

  @Get()
  @Contract({ tag: 'People', summary: "The tenant's roles", response: RoleListResult })
  @RequiresAny('user.manage', 'role.manage')
  async list(@CurrentAccess() access: Access): Promise<RoleListResult> {
    const items = await this.database.forTenant(access.tenantId, (tx) =>
      this.roles.list(tx, access.tenantId),
    );
    return { items };
  }

  @Post()
  @Contract({
    tag: 'People',
    summary: 'Create a role',
    body: CreateRoleBody,
    response: RoleResult,
    idempotencyKey: true,
  })
  @Requires('role.manage')
  @HttpCode(201)
  async create(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = CreateRoleBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/roles', by: access.userId, input },
        async () => ({
          status: 201,
          body: await this.roles.create(tx, access.tenantId, access, input),
        }),
      ),
    );
    return result.body;
  }

  @Patch(':id')
  @Contract({
    tag: 'People',
    summary: 'Change a role',
    params: IdParams,
    body: UpdateRoleBody,
    response: RoleResult,
  })
  @Requires('role.manage')
  update(@CurrentAccess() access: Access, @Param('id') id: string, @Body() body: unknown) {
    const roleId = pathId(id);
    const input = UpdateRoleBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.roles.update(tx, access, roleId, input),
    );
  }
}
