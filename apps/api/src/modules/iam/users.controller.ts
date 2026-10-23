import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateUserBody,
  IdParams,
  UpdateUserBody,
  UserListQuery,
  UserListResult,
  UserResult,
  UserView,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from './actor';
import { UsersService } from './users.service';

/** People (spec 11.2, module M3). */
@Controller('v1/users')
export class UsersController {
  constructor(
    private readonly database: Database,
    private readonly users: UsersService,
  ) {}

  @Get()
  @Contract({
    tag: 'People',
    summary: "The users the caller's scope reaches, a page at a time",
    query: UserListQuery,
    response: UserListResult,
  })
  @Requires('user.view')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = UserListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) => this.users.list(tx, access, input));
  }

  @Get(':id')
  @Contract({
    tag: 'People',
    summary: 'One user, with the phone they are bound to',
    params: IdParams,
    response: UserView,
  })
  @Requires('user.view')
  get(@CurrentAccess() access: Access, @Param('id') id: string) {
    const userId = pathId(id);
    return this.database.forTenant(access.tenantId, (tx) => this.users.get(tx, access, userId));
  }

  @Post()
  @Contract({
    tag: 'People',
    summary: 'Create a user',
    body: CreateUserBody,
    response: UserResult,
    idempotencyKey: true,
  })
  @Requires('user.manage')
  @HttpCode(201)
  async create(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = CreateUserBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/users', by: access.userId, input },
        async () => ({
          status: 201,
          body: await this.users.create(tx, access.tenantId, access, input),
        }),
      ),
    );
    return result.body;
  }

  @Patch(':id')
  @Contract({
    tag: 'People',
    summary: 'Change a user',
    params: IdParams,
    body: UpdateUserBody,
    response: UserResult,
  })
  @Requires('user.manage')
  update(@CurrentAccess() access: Access, @Param('id') id: string, @Body() body: unknown) {
    const userId = pathId(id);
    const input = UpdateUserBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.users.update(tx, access.tenantId, access, userId, input),
    );
  }

  @Post(':id/reset-device')
  @Contract({
    tag: 'People',
    summary: "Release a user's phone, so another can bind",
    params: IdParams,
    idempotencyKey: true,
  })
  @Requires('user.reset_device')
  @HttpCode(204)
  async resetDevice(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<void> {
    const userId = pathId(id);
    await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/users/:id/reset-device', by: access.userId, userId },
        async () => {
          await this.users.resetDevice(tx, access, userId);
          return { status: 204, body: null };
        },
      ),
    );
  }

  @Post(':id/sign-out-everywhere')
  @Contract({
    tag: 'People',
    summary: "End every one of a user's sessions",
    params: IdParams,
    idempotencyKey: true,
  })
  @Requires('user.sign_out_all')
  @HttpCode(204)
  async signOutEverywhere(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<void> {
    const userId = pathId(id);
    await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/users/:id/sign-out-everywhere', by: access.userId, userId },
        async () => {
          await this.users.signOutEverywhere(tx, access, userId);
          return { status: 204, body: null };
        },
      ),
    );
  }
}
