import { Injectable } from '@nestjs/common';
import { compactTrail, TRAIL_ACCURACY_M, todayIn } from '@kshetra/shared';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { locationPoints, shiftPauses, shiftTrails, shifts } from '../../db/schema/field';
import type { TenantTx } from '../../platform/database';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/**
 * Trail compaction (spec 12.1): a finished shift's raw points become one simplified line, with
 * its distance, gaps and pauses, which outlives the raw points. Running it again for a shift
 * writes the same trail.
 */
@Injectable()
export class TrailsService {
  constructor(private readonly config: TenantConfigService) {}

  async compact(tx: TenantTx, tenantId: string, shiftId: string): Promise<boolean> {
    const [shift] = await tx
      .select({
        userId: shifts.userId,
        startedAt: shifts.startedAt,
        endedAt: shifts.endedAt,
      })
      .from(shifts)
      .where(and(eq(shifts.tenantId, tenantId), eq(shifts.id, shiftId)))
      .for('update');
    if (!shift?.endedAt) return false;
    const { timezone } = await this.config.settings(tx, tenantId);
    const points = await tx
      .select({
        lat: sql<number>`ST_Y(${locationPoints.point}::geometry)`,
        lng: sql<number>`ST_X(${locationPoints.point}::geometry)`,
        accuracy: locationPoints.accuracy,
        capturedAt: locationPoints.capturedAt,
      })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.tenantId, tenantId),
          eq(locationPoints.shiftId, shiftId),
          // The partition key, so only the shift's days are read.
          sql`${locationPoints.capturedAt} between ${new Date(shift.startedAt.getTime() - 60_000)} and ${new Date(shift.endedAt.getTime() + 120_000)}`,
        ),
      )
      .orderBy(asc(locationPoints.capturedAt));
    // Distance from the accurate fixes, unsimplified, along the Earth (spec 12.1).
    const [measured] = await tx
      .select({
        distance: sql<
          number | null
        >`ST_Length(ST_MakeLine(${locationPoints.point}::geometry order by ${locationPoints.capturedAt})::geography)`,
      })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.tenantId, tenantId),
          eq(locationPoints.shiftId, shiftId),
          sql`${locationPoints.accuracy} <= ${TRAIL_ACCURACY_M}`,
          sql`${locationPoints.capturedAt} between ${new Date(shift.startedAt.getTime() - 60_000)} and ${new Date(shift.endedAt.getTime() + 120_000)}`,
        ),
      );
    const pauses = await tx
      .select({ from: shiftPauses.pausedAt, to: shiftPauses.resumedAt })
      .from(shiftPauses)
      .where(and(eq(shiftPauses.tenantId, tenantId), eq(shiftPauses.shiftId, shiftId)))
      .orderBy(asc(shiftPauses.pausedAt));
    const trail = compactTrail(
      points.map((point) => ({
        lat: Number(point.lat),
        lng: Number(point.lng),
        accuracy: point.accuracy,
        capturedAt: point.capturedAt.getTime(),
      })),
    );
    const distanceM = Math.round(Number(measured?.distance ?? 0));
    const row = {
      tenantId,
      shiftId,
      userId: shift.userId,
      date: todayIn(timezone, shift.startedAt),
      polyline: trail.polyline,
      pointCount: trail.pointCount,
      keptCount: trail.keptCount,
      distanceM,
      gaps: trail.gaps.map((gap) => ({
        from: new Date(gap.from).toISOString(),
        to: new Date(gap.to).toISOString(),
      })),
      pauses: pauses.map((pause) => ({
        from: pause.from.toISOString(),
        to: pause.to?.toISOString() ?? null,
      })),
    };
    await tx
      .insert(shiftTrails)
      .values(row)
      .onConflictDoUpdate({ target: [shiftTrails.tenantId, shiftTrails.shiftId], set: row });
    await tx
      .update(shifts)
      .set({ distanceM, compactedAt: new Date() })
      .where(and(eq(shifts.tenantId, tenantId), eq(shifts.id, shiftId)));
    return true;
  }

  /** Every finished shift not compacted yet, for the nightly job. */
  async pending(tx: TenantTx, tenantId: string): Promise<string[]> {
    const found = await tx
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(eq(shifts.tenantId, tenantId), isNotNull(shifts.endedAt), isNull(shifts.compactedAt)),
      );
    return found.map((shift) => shift.id);
  }
}
