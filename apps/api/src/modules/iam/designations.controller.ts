import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  CreateDesignationBody,
  type DesignationListResult,
  UpdateDesignationBody,
} from '@kshetra/shared';
import { type Access, CurrentAccess, Requires, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { pathId } from './actor';
import { DesignationsService } from './designations.service';

/** Designations (spec 11.2, People group). Everyone sees them, because every screen names them. */
@Controller('v1/designations')
export class DesignationsController {
  constructor(
    private readonly database: Database,
    private readonly designations: DesignationsService,
  ) {}

  @Get()
  @SignedIn()
  async list(@CurrentAccess() access: Access): Promise<DesignationListResult> {
    const items = await this.database.forTenant(access.tenantId, (tx) =>
      this.designations.list(tx, access.tenantId),
    );
    return { items };
  }

  @Post()
  @Requires('designation.manage')
  @HttpCode(201)
  async create(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = CreateDesignationBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/designations', by: access.userId, input },
        async () => ({
          status: 201,
          body: await this.designations.create(tx, access.tenantId, access, input),
        }),
      ),
    );
    return result.body;
  }

  @Patch(':id')
  @Requires('designation.manage')
  update(@CurrentAccess() access: Access, @Param('id') id: string, @Body() body: unknown) {
    const designationId = pathId(id);
    const input = UpdateDesignationBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.designations.update(tx, access, designationId, input),
    );
  }
}
