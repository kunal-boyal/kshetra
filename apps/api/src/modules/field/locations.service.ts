import { Injectable, Logger } from '@nestjs/common';
import {
  type LocationBatchBody,
  type LocationBatchResult,
  type PointRejectionKey,
  pointRejection,
  TRAIL_ACCURACY_M,
} from '@thelamp/shared';
import { and, asc, eq, gte, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { locationPoints, shifts, userLastPosition } from '../../db/schema/field';
import type { Access } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { pointSql } from '../../platform/geo';
import { RedisClient } from '../../platform/redis';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/** A point as the GPS audit trail shows it. */
export interface AuditPoint {
  id: string;
  shiftId: string;
  shiftStartedAt: Date;
  userId: string;
  capturedAt: Date;
  receivedAt: Date;
  lat: number;
  lng: number;
  accuracy: number;
  /** Metres a second, as the phone reported it. */
  speed: number | null;
  source: 'foreground' | 'background';
  /** Percent. */
  battery: number | null;
}

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

  /**
   * The GPS audit trail (M18, decision D99): every point the people in `people` sent, captured in
   * `[from, to)`, in capture order after `after`, with the shift it belongs to. Points are found
   * through the people's shifts that overlap the range, so only their partitions and index entries
   * are read, never the whole tenant's month.
   */
  async auditPoints(
    tx: TenantTx,
    tenantId: string,
    people: SQL,
    from: Date,
    to: Date,
    after: { capturedAt: Date; id: string } | null,
    limit: number,
  ): Promise<AuditPoint[]> {
    const rows = await tx
      .select({
        id: locationPoints.id,
        shiftId: locationPoints.shiftId,
        shiftStartedAt: shifts.startedAt,
        userId: locationPoints.userId,
        capturedAt: locationPoints.capturedAt,
        receivedAt: locationPoints.receivedAt,
        lat: sql<number>`ST_Y(${locationPoints.point}::geometry)`,
        lng: sql<number>`ST_X(${locationPoints.point}::geometry)`,
        accuracy: locationPoints.accuracy,
        speed: locationPoints.speed,
        source: locationPoints.source,
        battery: locationPoints.battery,
      })
      .from(locationPoints)
      .innerJoin(
        shifts,
        and(eq(shifts.tenantId, locationPoints.tenantId), eq(shifts.id, locationPoints.shiftId)),
      )
      .where(
        and(
          eq(locationPoints.tenantId, tenantId),
          eq(shifts.tenantId, tenantId),
          sql`${shifts.userId} in (${people})`,
          lt(shifts.startedAt, to),
          or(isNull(shifts.endedAt), gte(shifts.endedAt, from)),
          gte(locationPoints.capturedAt, from),
          lt(locationPoints.capturedAt, to),
          after
            ? sql`(${locationPoints.capturedAt}, ${locationPoints.id}) > (${after.capturedAt}, ${after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(locationPoints.capturedAt), asc(locationPoints.id))
      .limit(limit);
    return rows.map((row) => ({ ...row, lat: Number(row.lat), lng: Number(row.lng) }));
  }

  /**
   * A shift's accurate fixes in time order, for the day replay (M17): accuracy of 100 m or better
   * (spec 12.1), read through the parent table with the shift's time range, so only its days'
   * partitions are touched.
   */
  async fixes(
    tx: TenantTx,
    tenantId: string,
    shift: { id: string; startedAt: Date; endedAt: Date | null },
  ): Promise<{ lat: number; lng: number; capturedAt: Date }[]> {
    const until = shift.endedAt ?? new Date();
    const rows = await tx
      .select({
        lat: sql<number>`ST_Y(${locationPoints.point}::geometry)`,
        lng: sql<number>`ST_X(${locationPoints.point}::geometry)`,
        capturedAt: locationPoints.capturedAt,
      })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.tenantId, tenantId),
          eq(locationPoints.shiftId, shift.id),
          sql`${locationPoints.accuracy} <= ${TRAIL_ACCURACY_M}`,
          sql`${locationPoints.capturedAt} between ${new Date(shift.startedAt.getTime() - 60_000)} and ${new Date(until.getTime() + 120_000)}`,
        ),
      )
      .orderBy(asc(locationPoints.capturedAt));
    return rows.map((row) => ({
      lat: Number(row.lat),
      lng: Number(row.lng),
      capturedAt: row.capturedAt,
    }));
  }
}
