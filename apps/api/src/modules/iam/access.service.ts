import { Injectable } from '@nestjs/common';
import { AppError, isOpenTenant, type TenantPermission } from '@kshetra/shared';
import { and, eq } from 'drizzle-orm';
import { devices, roles, users } from '../../db/schema/iam';
import { type Access, AccessResolver, type AuthContext } from '../../platform/auth';
import { Database } from '../../platform/database';
import { TenantDirectory } from '../../platform/planes';

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
  ) {
    super();
  }

  async resolve(auth: AuthContext): Promise<Access> {
    const status = await this.tenants.status(auth.tenantId);
    if (!status) throw revoked();
    if (!isOpenTenant(status)) {
      throw new AppError(
        'TENANT_SUSPENDED',
        "Your organisation's account is suspended. Ask your administrator.",
      );
    }

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
      if (!user || !auth.deviceId) return { user };
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
      return { user, device };
    });

    const { user } = found;
    if (!user || user.status !== 'active' || user.authRevision !== auth.revision) throw revoked();
    if (auth.deviceId && (!found.device || found.device.revokedAt)) throw revoked();
    if (!auth.deviceId && user.mobileOnly) {
      throw new AppError('USE_MOBILE_APP', 'Use the mobile app to continue.');
    }
    return {
      ...auth,
      roleId: user.roleId,
      roleKey: user.roleKey,
      scope: user.scope,
      permissions: new Set(user.permissions as TenantPermission[]),
    };
  }
}
