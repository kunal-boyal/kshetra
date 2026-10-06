import { Controller, Get, Headers, Res } from '@nestjs/common';
import { ConfigBundle, TENANT_PERMISSIONS } from '@kshetra/shared';
import { resolveTerminology } from '@kshetra/i18n';
import type { FastifyReply } from 'fastify';
import { type Access, CurrentAccess, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { DesignationsService } from '../iam/designations.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/** True when an `If-None-Match` header names this ETag, weak or strong. */
function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === etag || tag === '*');
}

/**
 * `GET /v1/config` (spec 11.2): everything an app needs to speak the tenant's language and show
 * what the caller may do. The ETag carries the config version and the caller's role, so an app
 * that already has this bundle gets a bodiless 304 for the cost of one lookup. Forms, account
 * types, metrics and modules join the bundle as their modules arrive.
 */
@Controller('v1')
export class ConfigBundleController {
  constructor(
    private readonly database: Database,
    private readonly config: TenantConfigService,
    private readonly designations: DesignationsService,
  ) {}

  @Get('config')
  @Contract({
    tag: 'Configuration',
    summary: "The caller's config bundle",
    response: ConfigBundle,
    headers: [{ name: 'If-None-Match', description: 'The ETag of the bundle the caller holds' }],
    also: [{ status: 304, description: 'The bundle the caller holds is current' }],
  })
  @SignedIn()
  async bundle(
    @CurrentAccess() access: Access,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConfigBundle | undefined> {
    return this.database.forTenant(access.tenantId, async (tx) => {
      // The version is read first, so the bundle is never older than the ETag it is sent with.
      const version = await this.config.version(tx, access.tenantId);
      const etag = `"${version}-${access.roleId}"`;
      void reply.header('etag', etag).header('cache-control', 'private, no-cache');
      if (matches(ifNoneMatch, etag)) {
        void reply.status(304);
        return undefined;
      }
      // One transaction is one connection, so these run one after another.
      const settings = await this.config.settings(tx, access.tenantId);
      const overrides = await this.config.terminology(tx, access.tenantId);
      const designations = await this.designations.list(tx, access.tenantId);
      return {
        version,
        settings,
        terminology: Object.fromEntries(
          settings.languages.map((locale) => [locale, resolveTerminology(overrides, locale)]),
        ),
        designations: designations.map(({ key, name, level, ranked }) => ({
          key,
          name,
          level,
          ranked,
        })),
        access: {
          role: access.roleKey,
          scope: access.scope,
          permissions: TENANT_PERMISSIONS.filter((permission) =>
            access.permissions.has(permission),
          ),
        },
      };
    });
  }
}
