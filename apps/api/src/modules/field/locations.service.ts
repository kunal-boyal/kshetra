import { Injectable, Logger } from '@nestjs/common';
import {
  type LocationBatchBody,
  type LocationBatchResult,
  type PointRejectionKey,
  pointRejection,
} from '@kshetra/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { locationPoints, shifts, userLastPosition } from '../../db/schema/field';
import type { Access } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { pointSql } from '../../platform/geo';
import { RedisClient } from '../../platform/redis';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/** The Redis channel a tenant's live positions go out on, for the live map (M17). */
export const positionsChannel = (tenantId: string) => `positions:${tenantId}`;

/**
 * Location ingest (spec 12.1): each point is judged on its own against BR-36, the accepted ones
 * are written in one statement that ignores replays, and the newest becomes the person's last
 * position. It sits behind this service, so it can move to a queue and a writer later without the
 * phone noticing.
 */
@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private readonly database: Database,
    private readonly config: TenantConfigService,
    private readonly redis: RedisClient,
  ) {}

  async ingest(
    tx: TenantTx,
    access: Access,
    body: LocationBatchBody,
  ): Promise<LocationBatchResult> {
    const tenantId = access.tenantId;
    const settings = await this.config.settings(tx, tenantId);
    const now = Date.now();
    const shiftIds = [...new Set(body.points.map((point) => point.shiftId))];
    const windows = new Map(
      (
        await tx
          .select({
            id: shifts.id,
            userId: shifts.userId,
            startedAt: shifts.startedAt,
            endedAt: shifts.endedAt,
          })
          .from(shifts)
          .where(and(eq(shifts.tenantId, tenantId), inArray(shifts.id, shiftIds)))
      ).map((shift) => [
        shift.id,
        {
          userId: shift.userId,
          startedAt: shift.startedAt.getTime(),
          endedAt: shift.endedAt?.getTime() ?? null,
        },
      ]),
    );
    const accepted: LocationBatchBody['points'] = [];
    const rejected: { id: string; reason: PointRejectionKey }[] = [];
    const seen = new Set<string>();
    for (const point of body.points) {
      if (seen.has(point.id)) continue;
      seen.add(point.id);
      const reason = pointRejection(
        {
          capturedAt: Date.parse(point.capturedAt),
          accuracy: point.accuracy,
          mocked: point.mocked,
        },
        windows.get(point.shiftId) ?? null,
        {
          userId: access.userId,
          now,
          maxShiftHours: settings.maxShiftHours,
          syncWindowHours: settings.syncWindowHours,
        },
      );
      if (reason) rejected.push({ id: point.id, reason });
      else accepted.push(point);
    }
    if (accepted.length > 0) {
      await tx
        .insert(locationPoints)
        .values(
          accepted.map((point) => ({
            tenantId,
            id: point.id,
            shiftId: point.shiftId,
            userId: access.userId,
            capturedAt: new Date(point.capturedAt),
            point: pointSql(point.location),
            accuracy: point.accuracy,
            speed: point.speed ?? null,
            source: point.source,
            battery: point.battery ?? null,
          })),
        )
        .onConflictDoNothing();
      const latest = accepted.reduce((a, b) =>
        Date.parse(b.capturedAt) > Date.parse(a.capturedAt) ? b : a,
      );
      await tx
        .insert(userLastPosition)
        .values({
          tenantId,
          userId: access.userId,
          shiftId: latest.shiftId,
          capturedAt: new Date(latest.capturedAt),
          point: pointSql(latest.location),
          accuracy: latest.accuracy,
          battery: latest.battery ?? null,
        })
        .onConflictDoUpdate({
          target: [userLastPosition.tenantId, userLastPosition.userId],
          set: {
            shiftId: sql`excluded.shift_id`,
            capturedAt: sql`excluded.captured_at`,
            point: sql`excluded.point`,
            accuracy: sql`excluded.accuracy`,
            battery: sql`excluded.battery`,
          },
          // An older point, sent late from offline, never moves the person backwards.
          setWhere: sql`${userLastPosition.capturedAt} < excluded.captured_at`,
        });
      // Only what committed goes out on the live map.
      const message = JSON.stringify({
        userId: access.userId,
        shiftId: latest.shiftId,
        capturedAt: latest.capturedAt,
        location: latest.location,
        accuracy: latest.accuracy,
        battery: latest.battery ?? null,
      });
      this.database.afterCommit(tx, async () => {
        await this.redis.redis
          .publish(positionsChannel(tenantId), message)
          .catch((error: Error) =>
            this.logger.warn(`Live position not published: ${error.message}`),
          );
      });
    }
    return { accepted: accepted.map((point) => point.id), rejected };
  }
}
