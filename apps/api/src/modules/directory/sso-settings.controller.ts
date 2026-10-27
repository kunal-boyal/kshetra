import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { SsoConnectionBody, SsoConnectionResult, SsoDomainVerifyBody } from '@thelamp/shared';
import { AuditLog, userActor } from '../../platform/audit';
import { type Access, CurrentAccess, InModule, Requires, StepUp } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { SsoService } from './sso.service';

/**
 * A tenant's single sign-on connection, as its admins set it in Settings (decision D91), on the
 * SSO module. Its secrets never come back; the audit log keeps the settings without them.
 * Changing it needs a fresh authenticator code, and each email domain is proved by a DNS TXT
 * record before it signs anyone in (decision D101).
 */
@Controller('v1/sso')
@InModule('sso')
export class SsoSettingsController {
  constructor(
    private readonly sso: SsoService,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  @Get()
  @Requires('settings.manage')
  @Contract({
    tag: 'Settings',
    summary: 'The organisation’s single sign-on, and what its identity provider needs',
    response: SsoConnectionResult,
  })
  get(@CurrentAccess() access: Access) {
    return this.sso.connection(access.tenantId);
  }

  @Put()
  @Requires('settings.manage')
  @StepUp()
  @Contract({
    tag: 'Settings',
    summary: 'Set the organisation’s single sign-on',
    body: SsoConnectionBody,
    response: SsoConnectionResult,
  })
  async put(@CurrentAccess() access: Access, @Body() body: unknown) {
    const { before, after } = await this.sso.save(access.tenantId, SsoConnectionBody.parse(body));
    await this.database.forTenant(access.tenantId, (tx) =>
      this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'sso.changed',
        target: { type: 'organisation', id: access.tenantId },
        before,
        after,
      }),
    );
    return this.sso.connection(access.tenantId);
  }

  @Post('domains/verify')
  @Requires('settings.manage')
  @HttpCode(200)
  @Contract({
    tag: 'Settings',
    summary: 'Look for a domain’s TXT record now, proving the organisation holds it',
    body: SsoDomainVerifyBody,
    response: SsoConnectionResult,
  })
  async verifyDomain(@CurrentAccess() access: Access, @Body() body: unknown) {
    const { domain } = SsoDomainVerifyBody.parse(body);
    await this.sso.verifyDomain(access.tenantId, domain);
    await this.database.forTenant(access.tenantId, (tx) =>
      this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'sso.domain_verified',
        target: { type: 'organisation', id: access.tenantId },
        after: { domain: domain.toLowerCase() },
      }),
    );
    return this.sso.connection(access.tenantId);
  }
}
