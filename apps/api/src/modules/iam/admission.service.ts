import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError, needsSecondFactor, newId } from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { devices, roles, users } from '../../db/schema/iam';
import { type AuditActor, AuditLog } from '../../platform/audit';
import { Database, type TenantTx } from '../../platform/database';
import { type Admission, type AdmissionRequest, CellAdmission } from '../../platform/planes';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/**
 * Admits a sign-in on behalf of the tenant (M1, rules 5 and 9). The user must be active, and a web
 * sign-in needs a role allowed on the web. With device binding on (the default, spec 5.1 and D15),
 * a phone must be the one the user is bound to, or becomes it when they have none (BR-38); with it
 * off, every phone is recorded and none is refused. Sign-ins and refused phones go in the audit
 * log (module M21).
 */
@Injectable()
export class IamAdmission extends CellAdmission {
  constructor(
    private readonly database: Database,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {
    super();
  }

  async admit({ tenantId, userId, device, ip }: AdmissionRequest): Promise<Admission> {
    const actor: AuditActor = { kind: 'user', id: userId, ip: ip ?? null };
    const outcome = await this.database.forTenant(tenantId, async (tx) => {
      // Locking the user makes two phones signing in at once take turns, so only one binds.
      const [user] = await tx
        .select({ status: users.status, roleId: users.roleId })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
        .for('update');
      if (!user || user.status !== 'active') {
        throw new AppError('FORBIDDEN', 'This account is not active. Ask your administrator.');
      }
      if (!device) {
        const [role] = await tx
          .select({ mobileOnly: roles.mobileOnly, permissions: roles.permissions })
          .from(roles)
          .where(and(eq(roles.tenantId, tenantId), eq(roles.id, user.roleId)));
        if (role?.mobileOnly) {
          throw new AppError('USE_MOBILE_APP', 'Use the mobile app to sign in.');
        }
        await this.signedIn(tx, tenantId, actor, userId, null, 'web');
        return { secondFactor: needsSecondFactor(role?.permissions ?? []) };
      }

      const keyHash = createHash('sha256').update(device.key).digest('hex');
      const owned = await tx
        .select({
          id: devices.id,
          keyHash: devices.deviceKeyHash,
          boundAt: devices.boundAt,
          revokedAt: devices.revokedAt,
        })
        .from(devices)
        .where(and(eq(devices.tenantId, tenantId), eq(devices.userId, userId)));
      const same = owned.find((known) => known.keyHash === keyHash);
      const inUse = same !== undefined && same.revokedAt === null;
      const { deviceBinding } = await this.config.settings(tx, tenantId);
      // A phone already in use carries on, including any let in while binding was off; a new
      // phone binds only when the user has none.
      if (deviceBinding && !inUse && owned.some((other) => other.revokedAt === null)) {
        return { refused: true as const };
      }

      const now = new Date();
      const details = {
        platform: device.platform,
        model: device.model ?? null,
        osVersion: device.osVersion ?? null,
        appVersion: device.appVersion ?? null,
        lastSeenAt: now,
      };
      // `bound_at` is when the phone became the user's bound one. A phone let in while binding is
      // off has none until it signs in with binding on.
      if (same) {
        await tx
          .update(devices)
          .set({
            ...details,
            revokedAt: null,
            boundAt: inUse && same.boundAt ? same.boundAt : deviceBinding ? now : null,
          })
          .where(and(eq(devices.tenantId, tenantId), eq(devices.id, same.id)));
        await this.signedIn(tx, tenantId, actor, userId, same.id, device.platform);
        return { deviceId: same.id };
      }
      const id = newId();
      await tx.insert(devices).values({
        id,
        tenantId,
        userId,
        deviceKeyHash: keyHash,
        ...details,
        boundAt: deviceBinding ? now : null,
      });
      await this.signedIn(tx, tenantId, actor, userId, id, device.platform);
      return { deviceId: id };
    });

    if ('refused' in outcome) {
      // Recorded on its own, since the refusal leaves nothing else to commit.
      await this.database.forTenant(tenantId, (tx) =>
        this.audit.record(tx, tenantId, actor, {
          action: 'session.device_refused',
          target: { type: 'user', id: userId },
          after: { platform: device?.platform, model: device?.model ?? null },
        }),
      );
      throw new AppError(
        'DEVICE_NOT_BOUND',
        'This phone is not registered for your account. Ask your manager to reset your device.',
      );
    }
    return outcome;
  }

  private signedIn(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    userId: string,
    deviceId: string | null,
    platform: string | null,
  ): Promise<void> {
    return this.audit.record(
      tx,
      tenantId,
      { ...actor, deviceId },
      {
        action: 'session.signed_in',
        target: { type: 'user', id: userId },
        after: { deviceId, platform },
      },
    );
  }
}
