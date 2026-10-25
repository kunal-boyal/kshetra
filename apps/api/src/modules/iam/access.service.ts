import { Injectable } from '@nestjs/common';
import {
  AppError,
  effectivePermissions,
  isOpenTenant,
  API_CLIENT_ROLE_KEY,
  scopePermissions,
  SUPPORT_ROLE_KEY,
  supportPermissions,
  type TenantPermission,
} from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { devices, roles, users } from '../../db/schema/iam';
import { type Access, AccessResolver, type AuthContext } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Entitlements, SupportGrants, TenantDirectory } from '../../platform/planes';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { ApiClientsService } from './api-clients.service';

const revoked = () => new AppError('SESSION_REVOKED', 'Your session has ended. Sign in again.');

/**
 * The checks every request passes (M1, rules 7 and 9; BR-39): the tenant is open, the user is
 * active at the token's auth revision, the token's device has not been reset, and a web session
 * belongs to a role allowed on the web.
 */
@Injectable()
export class IamAccess extends AccessResolver {
  constructor(
    private readonly database: Database,
    private readonly tenants: TenantDirectory,
    private readonly config: TenantConfigService,
    private readonly entitlements: Entitlements,
    private readonly support: SupportGrants,
    private readonly clients: ApiClientsService,
  ) {
    super();
  }

  async resolve(auth: AuthContext): Promise<Access> {
    return this.load(auth, true);
  }

  /** Someone's access; `asRequest` refuses a phone-only role without a phone, as a request is. */
  private async load(auth: AuthContext, asRequest: boolean): Promise<Access> {
    const status = await this.tenants.status(auth.tenantId);
    if (!status) throw revoked();
    if (!isOpenTenant(status)) {
      throw new AppError(
        'TENANT_SUSPENDED',
        "Your organisation's subscription is suspended. Ask an admin about billing.",
      );
    }

    if (auth.supportGrantId) return this.supportAccess(auth, auth.supportGrantId, status);
    if (auth.scopes) return this.clientAccess(auth, auth.scopes, status);

    const found = await this.database.forTenant(auth.tenantId, async (tx) => {
      const [user] = await tx
        .select({
          status: users.status,
          authRevision: users.authRevision,
          roleId: roles.id,
          roleKey: roles.key,
          scope: roles.scope,
          permissions: roles.permissions,
          mobileOnly: roles.mobileOnly,
        })
        .from(users)
        .innerJoin(roles, and(eq(roles.tenantId, users.tenantId), eq(roles.id, users.roleId)))
        .where(and(eq(users.tenantId, auth.tenantId), eq(users.id, auth.userId)));
      const { modulesOff } = await this.config.settings(tx, auth.tenantId);
      if (!user || !auth.deviceId) return { user, modulesOff };
      const [device] = await tx
        .select({ revokedAt: devices.revokedAt })
        .from(devices)
        .where(
          and(
            eq(devices.tenantId, auth.tenantId),
            eq(devices.id, auth.deviceId),
            eq(devices.userId, auth.userId),
          ),
        );
      return { user, device, modulesOff };
    });

    const { user } = found;
    if (!user || user.status !== 'active' || user.authRevision !== auth.revision) throw revoked();
    if (auth.deviceId && (!found.device || found.device.revokedAt)) throw revoked();
    if (asRequest && !auth.deviceId && user.mobileOnly) {
      throw new AppError('USE_MOBILE_APP', 'Use the mobile app to continue.');
    }
    return {
      ...auth,
      roleId: user.roleId,
      roleKey: user.roleKey,
      scope: user.scope,
      permissions: effectivePermissions(user.permissions as TenantPermission[], found.modulesOff),
      modulesOff: found.modulesOff,
      readOnly: await this.readOnly(auth.tenantId, status),
    };
  }

  /** Unpaid past grace (BR-48), or a dedicated install whose licence lapsed (BR-49). */
  private async readOnly(tenantId: string, status: string): Promise<boolean> {
    return (
      status === 'read_only' || ((await this.entitlements.forTenant(tenantId)).readOnly ?? false)
    );
  }

  /**
   * An API client (module M20, decision D94): no user of the tenant either. While the client is
   * active at the token's revision, it reaches the whole tenant with the permissions of the scopes
   * the token holds, which are no more than the client's own.
   */
  private async clientAccess(
    auth: AuthContext,
    tokenScopes: readonly string[],
    status: string,
  ): Promise<Access> {
    const found = await this.database.forTenant(auth.tenantId, async (tx) => ({
      client: await this.clients.state(tx, auth.tenantId, auth.userId),
      settings: await this.config.settings(tx, auth.tenantId),
    }));
    const { client, settings } = found;
    if (!client || client.authRevision !== auth.revision) throw revoked();
    const scopes = client.scopes.filter((scope) => tokenScopes.includes(scope));
    return {
      ...auth,
      roleId: client.id,
      roleKey: API_CLIENT_ROLE_KEY,
      scope: 'tenant',
      permissions: effectivePermissions(scopePermissions(scopes), settings.modulesOff),
      modulesOff: settings.modulesOff,
      readOnly: await this.readOnly(auth.tenantId, status),
      apiClient: { id: client.id, name: client.name, scopes },
    };
  }

  /**
   * Vendor support under a grant (module M22, decision D93): no user of the tenant, so nothing is
   * read from its people. While the grant is open, the session reaches the whole tenant with every
   * permission but those withheld; a read grant's writes are refused by the guard.
   */
  private async supportAccess(auth: AuthContext, grantId: string, status: string): Promise<Access> {
    const grant = await this.support.open(grantId);
    if (
      !grant ||
      grant.tenantId !== auth.tenantId ||
      grant.staffId !== auth.userId ||
      grant.staffRevision !== auth.revision
    ) {
      throw revoked();
    }
    const { modulesOff } = await this.database.forTenant(auth.tenantId, (tx) =>
      this.config.settings(tx, auth.tenantId),
    );
    return {
      ...auth,
      roleId: grant.id,
      roleKey: SUPPORT_ROLE_KEY,
      scope: 'tenant',
      permissions: effectivePermissions(supportPermissions(), modulesOff),
      modulesOff,
      readOnly: await this.readOnly(auth.tenantId, status),
      support: {
        grantId: grant.id,
        staffName: grant.staffName,
        write: grant.write,
        endsAt: grant.endsAt,
      },
    };
  }

  /**
   * The access someone holds now, for work done on their behalf, such as an import they started
   * or checking what a person planned for may see: their current role and scope, with no phone.
   * A phone-only role is no bar, as nobody signs in; it is refused, as a request would be, once
   * they or the tenant are no longer active.
   */
  async onBehalfOf(tenantId: string, userId: string, cell: string): Promise<Access> {
    const revision = await this.database.forTenant(tenantId, async (tx) => {
      const [user] = await tx
        .select({ authRevision: users.authRevision })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
      return user?.authRevision;
    });
    if (revision === undefined) throw revoked();
    return this.load({ userId, tenantId, cell, revision }, false);
  }
}
