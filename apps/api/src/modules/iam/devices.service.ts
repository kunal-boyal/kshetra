import { Injectable } from '@nestjs/common';
import { AppError, type DeviceHealth, type DeviceHeartbeatBody } from '@kshetra/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { devices } from '../../db/schema/iam';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';

/** Device time minus server time, in whole seconds, or null without a readable device time. */
export function clockSkewSeconds(deviceTime: string | undefined, now: Date): number | null {
  if (!deviceTime) return null;
  const at = Date.parse(deviceTime);
  return Number.isNaN(at) ? null : Math.round((at - now.getTime()) / 1_000);
}

/**
 * The phones people sign in on (spec 10.3, M3). The app reports its health in a heartbeat; the
 * web shows it on the person's record, and the reset screen shows the last queue size (spec 11.3).
 */
@Injectable()
export class DevicesService {
  /** Each device's integrity verdict (spec 13.2), null until verdicts are collected. */
  async verdicts(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string | null>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: devices.id, verdict: devices.integrityVerdict })
      .from(devices)
      .where(and(eq(devices.tenantId, tenantId), inArray(devices.id, [...ids])));
    return new Map(rows.map((row) => [row.id, row.verdict]));
  }

  /**
   * Keeps the latest heartbeat of the caller's phone. It replaces the one before, so sending it
   * twice is harmless, and as telemetry rather than a change anyone makes, it isn't audited.
   */
  async heartbeat(
    tx: TenantTx,
    access: Access,
    body: DeviceHeartbeatBody,
    deviceTime: string | undefined,
  ): Promise<void> {
    if (!access.deviceId) {
      throw new AppError('USE_MOBILE_APP', 'Only the mobile app reports device health.');
    }
    const now = new Date();
    const health: DeviceHealth = {
      ...body,
      receivedAt: now.toISOString(),
      clockSkewSeconds: clockSkewSeconds(deviceTime, now),
    };
    const [device] = await tx
      .update(devices)
      .set({
        health,
        appVersion: body.appVersion,
        osVersion: body.osVersion,
        ...(body.model ? { model: body.model } : {}),
        lastSeenAt: now,
      })
      .where(
        and(
          eq(devices.tenantId, access.tenantId),
          eq(devices.id, access.deviceId),
          eq(devices.userId, access.userId),
          isNull(devices.revokedAt),
        ),
      )
      .returning({ id: devices.id });
    // The device was reset after this request's access check.
    if (!device) throw new AppError('SESSION_REVOKED', 'This phone was reset. Sign in again.');
  }
}
