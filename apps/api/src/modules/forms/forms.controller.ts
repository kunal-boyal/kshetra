import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { FormListResult, FormView, PublishFormBody, UpdateFormBody } from '@kshetra/forms';
import { IdParams } from '@kshetra/shared';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { FormsService } from './forms.service';

/** Forms (spec 5.6, 11.2). Phones receive the forms they fill in the config bundle. */
@Controller('v1/forms')
export class FormsController {
  constructor(
    private readonly database: Database,
    private readonly forms: FormsService,
  ) {}

  @Get()
  @Contract({
    tag: 'Forms',
    summary: 'Every form, in use or not, at its current version',
    response: FormListResult,
  })
  @Requires('form.manage')
  list(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, async (tx) => ({
      items: await this.forms.list(tx, access.tenantId),
    }));
  }

  @Post()
  @Contract({
    tag: 'Forms',
    summary: 'Add a form, as its first version',
    body: PublishFormBody,
    response: FormView,
    idempotencyKey: true,
  })
  @Requires('form.manage')
  @HttpCode(201)
  async create(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = PublishFormBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/forms', by: access.userId, input },
        async () => ({ status: 201, body: await this.forms.create(tx, access, input.definition) }),
      ),
    );
    return result.body;
  }

  @Post(':id/versions')
  @Contract({
    tag: 'Forms',
    summary: "Publish a form's next version",
    params: IdParams,
    body: PublishFormBody,
    response: FormView,
    idempotencyKey: true,
  })
  @Requires('form.manage')
  @HttpCode(201)
  async publish(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const formId = pathId(id);
    const input = PublishFormBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/forms/:id/versions', by: access.userId, formId, input },
        async () => ({
          status: 201,
          body: await this.forms.publish(tx, access, formId, input.definition),
        }),
      ),
    );
    return result.body;
  }

  @Patch(':id')
  @Contract({
    tag: 'Forms',
    summary: 'Switch a form off or on',
    params: IdParams,
    body: UpdateFormBody,
    response: FormView,
  })
  @Requires('form.manage')
  update(@CurrentAccess() access: Access, @Param('id') id: string, @Body() body: unknown) {
    const formId = pathId(id);
    const input = UpdateFormBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.forms.setActive(tx, access, formId, input.active),
    );
  }
}
