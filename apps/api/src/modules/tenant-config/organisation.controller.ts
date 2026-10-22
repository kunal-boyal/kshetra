import { Body, Controller, Delete, Get, Headers, Patch, Put } from '@nestjs/common';
import { AppError, OrganisationResult, UpdateOrganisationBody } from '@kshetra/shared';
import { type Access, CurrentAccess, Requires, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { OrganisationService } from './organisation.service';

/**
 * The organisation's name and logo (M2, spec 5.1, decision D64). Everyone signed in reads them,
 * for the app's header; those who manage settings change them. Each change replaces the state, so
 * a repeated request changes nothing more.
 */
@Controller('v1/organisation')
export class OrganisationController {
  constructor(
    private readonly database: Database,
    private readonly organisation: OrganisationService,
  ) {}

  @Get()
  @Contract({
    tag: 'Settings',
    summary: "The organisation's display name and logo",
    response: OrganisationResult,
  })
  @SignedIn()
  read(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, (tx) =>
      this.organisation.read(tx, access.tenantId),
    );
  }

  @Patch()
  @Contract({
    tag: 'Settings',
    summary: 'Rename the organisation, as people see it',
    body: UpdateOrganisationBody,
    response: OrganisationResult,
  })
  @Requires('settings.manage')
  rename(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = UpdateOrganisationBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.organisation.rename(tx, access, input.name),
    );
  }

  @Put('logo')
  @Contract({
    tag: 'Settings',
    summary: 'Replace the logo with a PNG, JPEG or WebP image sent as the body',
    response: OrganisationResult,
    headers: [{ name: 'Content-Type', description: 'image/png, image/jpeg or image/webp' }],
  })
  @Requires('settings.manage')
  setLogo(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('content-type') contentType: string | undefined,
  ) {
    if (!(body instanceof Uint8Array)) {
      throw new AppError('VALIDATION', 'Send the image itself as the body.', [
        { path: 'body', issue: 'Send a PNG, JPEG or WebP image' },
      ]);
    }
    return this.database.forTenant(access.tenantId, (tx) =>
      this.organisation.setLogo(tx, access, contentType ?? '', body),
    );
  }

  @Delete('logo')
  @Contract({ tag: 'Settings', summary: 'Remove the logo', response: OrganisationResult })
  @Requires('settings.manage')
  removeLogo(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, (tx) =>
      this.organisation.removeLogo(tx, access),
    );
  }
}
