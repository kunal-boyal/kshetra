import { Injectable } from '@nestjs/common';
import { gapBefore } from '@thelamp/shared';
import type { TenantTx } from '../../platform/database';
import { LocationsService } from '../field/locations.service';
import { People } from '../iam/people';
import { monthMoments } from './report-helpers';
import {
  type ColumnSpec,
  type ReportContext,
  type ReportRow,
  ReportSource,
  type SourcePage,
} from './sources';

/** Where a page ended: the last point's capture time, ID and shift, so the next marks its gap. */
function cursorOf(cursor: string | undefined) {
  const [at, id, shiftId] = cursor?.split('~') ?? [];
  const capturedAt = at ? new Date(at) : null;
  if (!capturedAt || Number.isNaN(capturedAt.getTime()) || !id || !shiftId) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(shiftId)) return null;
  return { capturedAt, id, shiftId };
}

/**
 * The GPS audit trail (M18, decision D99): every point one person's phone sent in the month, in
 * the order captured, with when it reached the server, where, how accurately, how fast, on what
 * battery, whether the app was open, and the silence before it when that was a gap (BR-36, M5).
 * It reads the raw points, so days whose points have left the database (BR-41) show none; their
 * trail stays in the location summary.
 */
@Injectable()
export class GpsAuditTrailReport extends ReportSource {
  readonly key = 'gps_audit_trail' as const;

  constructor(
    private readonly people: People,
    private readonly locations: LocationsService,
  ) {
    super();
  }

  async columns(): Promise<ColumnSpec[]> {
    return [
      { key: 'captured_at', label: 'report.col_point_captured_at', kind: 'datetime' },
      { key: 'received_at', label: 'report.col_point_received_at', kind: 'datetime' },
      { key: 'user_code', label: 'report.col_user_code', kind: 'text' },
      { key: 'user_name', label: 'report.col_user_name', kind: 'text' },
      { key: 'shift_started_at', label: 'report.col_shift_started_at', kind: 'datetime' },
      { key: 'latitude', label: 'report.col_latitude', kind: 'decimal' },
      { key: 'longitude', label: 'report.col_longitude', kind: 'decimal' },
      { key: 'accuracy', label: 'report.col_accuracy', kind: 'number' },
      { key: 'speed_kmh', label: 'report.col_speed_kmh', kind: 'number' },
      { key: 'battery', label: 'report.col_battery', kind: 'percent' },
      { key: 'source', label: 'report.col_source', kind: 'text' },
      { key: 'gap_minutes', label: 'report.col_gap_minutes', kind: 'number' },
    ];
  }

  async page(
    tx: TenantTx,
    context: ReportContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<SourcePage> {
    const after = cursorOf(cursor);
    const { from, to } = monthMoments(context);
    const found = await this.locations.auditPoints(
      tx,
      context.tenantId,
      context.people,
      from,
      to,
      after,
      limit + 1,
    );
    const shown = found.slice(0, limit);
    const people = await this.people.facts(tx, context.tenantId, [
      ...new Set(shown.map((point) => point.userId)),
    ]);
    let previous: { shiftId: string; capturedAt: number } | null = after
      ? { shiftId: after.shiftId, capturedAt: after.capturedAt.getTime() }
      : null;
    const rows: ReportRow[] = shown.map((point) => {
      const here = { shiftId: point.shiftId, capturedAt: point.capturedAt.getTime() };
      const gap = gapBefore(previous, here);
      previous = here;
      return {
        captured_at: point.capturedAt.toISOString(),
        received_at: point.receivedAt.toISOString(),
        user_code: people.get(point.userId)?.code ?? null,
        user_name: people.get(point.userId)?.name ?? null,
        shift_started_at: point.shiftStartedAt.toISOString(),
        // Six places is about 11 cm, finer than any phone's fix.
        latitude: point.lat.toFixed(6),
        longitude: point.lng.toFixed(6),
        accuracy: Math.round(point.accuracy),
        speed_kmh: point.speed === null ? null : Math.round(point.speed * 36) / 10,
        battery: point.battery,
        source: context.text(`report.source_${point.source}`),
        gap_minutes: gap,
      };
    });
    const last = shown.at(-1);
    return {
      rows,
      nextCursor:
        found.length > limit && last
          ? `${last.capturedAt.toISOString()}~${last.id}~${last.shiftId}`
          : null,
    };
  }
}
