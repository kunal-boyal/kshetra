import { Inject, Injectable } from '@nestjs/common';
import {
  AppError,
  effectivePermissions,
  isOpenTenant,
  API_CLIENT_ROLE_KEY,
  scopePermissions,
  SUPPORT_ROLE_KEY,
  supportPermissions,
  type TenantPermission,
  SECOND_FACTOR_PERMISSIONS,
} from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { devices, roles, users } from '../../db/schema/iam';
import { type Access, AccessResolver, type AuthContext } from '../../platform/auth';
import { Database } from '../../platform/database';
import type { Config } from '../../config';
import {
  Entitlements,
  SupportGrants,
  TenantDirectory,
  type TenantStanding,
} from '../../platform/planes';
import { CONFIG } from '../../platform/tokens';
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
    @Inject(CONFIG) private readonly cellConfig: Config,
    private readonly clients: ApiClientsService,
  ) {
    super();
  }

  async resolve(auth: AuthContext): Promise<Access> {
    return this.load(auth, true);
  }

  /** Someone's access; `asRequest` refuses a phone-only role without a phone, as a request is. */
  private async load(auth: AuthContext, asRequest: boolean): Promise<Access> {
    const standing = await this.tenants.standing(auth.tenantId);
    if (!standing) throw revoked();
    const { status } = standing;
    if (!isOpenTenant(status)) {
      throw new AppError(
        'TENANT_SUSPENDED',
        "Your organisation's subscription is suspended. Ask an admin about billing.",
      );
    }

    // The tenant lives on another cell now (decision D95): a refresh of the session names it.
    if (standing.cell !== this.cellConfig.CELL_ID) {
      throw new AppError('TENANT_MOVED', 'Your organisation has moved to a new server. Try again.');
    }

    if (auth.supportGrantId) return this.supportAccess(auth, auth.supportGrantId, standing);
    if (auth.scopes) return this.clientAccess(auth, auth.scopes, standing);

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
    // Changing access is web-only, behind the authenticator (decisions D91 and D101): a phone's
    // token, which never gave one, carries none of those permissions, wherever it is sent from.
    const held = (user.permissions as TenantPermission[]).filter(
      (permission) =>
        !auth.deviceId || !(SECOND_FACTOR_PERMISSIONS as readonly string[]).includes(permission),
    );
    return {
      ...auth,
      roleId: user.roleId,
      roleKey: user.roleKey,
      scope: user.scope,
      permissions: effectivePermissions(held, found.modulesOff),
      modulesOff: found.modulesOff,
      ...(await this.state(auth.tenantId, standing)),
    };
  }

  /**
   * Read only: unpaid past grace (BR-48), or a dedicated install whose licence lapsed (BR-49).
   * Moving: on its way to another cell (decision D95).
   */
  private async state(tenantId: string, standing: TenantStanding) {
    return {
      readOnly:
        standing.status === 'read_only' ||
        ((await this.entitlements.forTenant(tenantId)).readOnly ?? false),
      ...(standing.moving ? { moving: true } : {}),
    };
  }

  /**
   * An API client (module M20, decision D94): no user of the tenant either. While the client is
   * active at the token's revision, it reaches the whole tenant with the permissions of the scopes
   * the token holds, which are no more than the client's own.
   */
  private async clientAccess(
    auth: AuthContext,
    tokenScopes: readonly string[],
    standing: TenantStanding,
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
      ...(await this.state(auth.tenantId, standing)),
      apiClient: { id: client.id, name: client.name, scopes },
    };
  }

  /**
   * Vendor support under a grant (module M22, decision D93): no user of the tenant, so nothing is
   * read from its people. While the grant is open, the session reaches the whole tenant with every
   * permission but those withheld; a read grant's writes are refused by the guard.
   */
  private async supportAccess(
    auth: AuthContext,
    grantId: string,
    standing: TenantStanding,
  ): Promise<Access> {
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
      ...(await this.state(auth.tenantId, standing)),
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
