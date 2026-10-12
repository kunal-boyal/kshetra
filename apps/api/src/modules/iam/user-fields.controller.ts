import { Body, Controller, Get, Put } from '@nestjs/common';
import { UpdateUserFieldsBody, UserFieldsResult } from '@kshetra/forms';
import { type Access, CurrentAccess, Requires, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { UserFieldsService } from './user-fields.service';

/** The tenant's custom user fields (spec 5.3). */
@Controller('v1/user-fields')
export class UserFieldsController {
  constructor(
    private readonly database: Database,
    private readonly fields: UserFieldsService,
  ) {}

  @Get()
  @Contract({
    tag: 'People',
    summary: "The tenant's custom user fields, in use and retired",
    response: UserFieldsResult,
  })
  @SignedIn()
  get(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, (tx) => this.fields.get(tx, access.tenantId));
  }

  @Put()
  @Contract({
    tag: 'People',
    summary: 'Replace the custom user fields in use; those left out retire',
    body: UpdateUserFieldsBody,
    response: UserFieldsResult,
  })
  @Requires('settings.manage')
  replace(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = UpdateUserFieldsBody.parse(body);
    // Replacing with the same list again gives the same result, so it needs no key.
    return this.database.forTenant(access.tenantId, (tx) =>
      this.fields.replace(tx, access.tenantId, access, input),
    );
  }
}
