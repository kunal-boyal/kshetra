import { Injectable } from '@nestjs/common';
import {
  ANOMALY_LOOK_HOURS,
  type AnomalyFlag,
  anomalyFlags,
  AppError,
  type FlagNotes,
  type GeoPoint,
  MOCK_HISTORY_DAYS,
  MOCK_REPORT_KEEP_DAYS,
  type MockLocationReportBody,
  type MockLocationReportResult,
  type MockSource,
  FUTURE_TOLERANCE_MS,
  type PlacedRecord,
} from '@thelamp/shared';
import { and, desc, eq, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import { mockLocationReports, submissions } from '../../db/schema/field';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { pointOf } from '../../platform/geo';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { ShiftsService } from './shifts.service';
import { VisitsService } from './visits.service';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A submission about to be stored, as the anomaly checks see it. */
export interface NewSubmission {
  id: string;
  userId: string;
  capturedAt: number;
  point: GeoPoint;
  accuracy: number;
  accountId: string | null;
  onShift: boolean;
  photos: readonly {
    id: string;
    point: GeoPoint | null;
    accuracy: number | null;
    mocked: boolean | null;
  }[];
}

/**
 * Anomalies in evidence (BR-50, decision D119): flags for reviewers, never refusals. A new
 * submission is compared with the person's records 12 hours either side; a pair or burst it makes
 * also flags the person's other submissions in it while they wait for review. The phone's reports
 * of mocked fixes live here too.
 */
@Injectable()
export class Anomalies {
  constructor(
    private readonly config: TenantConfigService,
    private readonly visits: VisitsService,
    private readonly shifts: ShiftsService,
  ) {}

  /** The flags and notes of a new submission, flagging the waiting submissions it pairs with. */
  async judge(
    tx: TenantTx,
    tenantId: string,
    record: NewSubmission,
  ): Promise<{ flags: AnomalyFlag[]; notes: FlagNotes }> {
    const off = (await this.config.settings(tx, tenantId)).anomalyFlagsOff;
    const from = new Date(record.capturedAt - ANOMALY_LOOK_HOURS * HOUR_MS);
    const to = new Date(record.capturedAt + ANOMALY_LOOK_HOURS * HOUR_MS);
    const others = [
      ...(await this.submissionsNear(tx, tenantId, record.userId, record.id, from, to)),
      ...(await this.visits.placedNear(tx, tenantId, record.userId, from, to)),
      ...(await this.shifts.placedNear(tx, tenantId, record.userId, from, to)),
    ];
    const found = anomalyFlags(
      {
        record: {
          kind: 'submission',
          id: record.id,
          at: record.capturedAt,
          point: record.point,
          accountId: record.accountId,
          accuracy: record.accuracy,
        },
        others,
        photos: record.photos,
        onShift: record.onShift,
        lastMockReport: await this.lastReport(tx, tenantId, record.userId, record.capturedAt),
      },
      off,
    );
    const at = new Date(record.capturedAt).toISOString();
    for (const { other, note } of found.fastWith) {
      if (other.kind !== 'submission') continue;
      await this.flagWaiting(tx, tenantId, [other.id], 'fast_travel', {
        otherKind: 'submission',
        otherId: record.id,
        otherAt: at,
        distanceM: note.distanceM,
        seconds: note.seconds,
      });
    }
    if (found.notes.burst) {
      const ids = found.burstWith.filter((other) => other.kind === 'submission').map((o) => o.id);
      await this.flagWaiting(tx, tenantId, ids, 'burst', found.notes.burst);
    }
    return { flags: found.flags, notes: found.notes };
  }

  /** The person's other submissions between two moments, as places and times. */
  private async submissionsNear(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    except: string,
    from: Date,
    to: Date,
  ): Promise<PlacedRecord[]> {
    const rows = await tx
      .select({
        id: submissions.id,
        capturedAt: submissions.capturedAt,
        point: pointOf(submissions.point),
        accountId: submissions.accountId,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.tenantId, tenantId),
          eq(submissions.userId, userId),
          ne(submissions.id, except),
          gte(submissions.capturedAt, from),
          lte(submissions.capturedAt, to),
        ),
      );
    return rows.flatMap((row) =>
      row.point
        ? [
            {
              kind: 'submission' as const,
              id: row.id,
              at: row.capturedAt.getTime(),
              point: row.point,
              accountId: row.accountId,
            },
          ]
        : [],
    );
  }

  /** Adds a flag and its note to those of these submissions still waiting that lack it. */
  private async flagWaiting<F extends AnomalyFlag>(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
    flag: F,
    note: NonNullable<FlagNotes[F]>,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const changed = await tx
      .update(submissions)
      .set({
        flags: sql`array_append(${submissions.flags}, ${flag}::cell.submission_flag)`,
        flagNotes: sql`${submissions.flagNotes} || ${JSON.stringify({ [flag]: note })}::jsonb`,
      })
      .where(
        and(
          eq(submissions.tenantId, tenantId),
          inArray(submissions.id, [...ids]),
          eq(submissions.status, 'pending'),
          sql`not (${flag}::cell.submission_flag = any(${submissions.flags}))`,
        ),
      )
      .returning({ id: submissions.id });
    return changed.length;
  }

  /** The latest mocked fix the person's phone reported at or before a moment. */
  private async lastReport(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    at: number,
  ): Promise<{ seenAt: number; source: MockSource } | null> {
    const [row] = await tx
      .select({ seenAt: mockLocationReports.seenAt, source: mockLocationReports.source })
      .from(mockLocationReports)
      .where(
        and(
          eq(mockLocationReports.tenantId, tenantId),
          eq(mockLocationReports.userId, userId),
          lte(mockLocationReports.seenAt, new Date(at)),
          gte(mockLocationReports.seenAt, new Date(at - MOCK_HISTORY_DAYS * DAY_MS)),
        ),
      )
      .orderBy(desc(mockLocationReports.seenAt))
      .limit(1);
    return row ? { seenAt: row.seenAt.getTime(), source: row.source } : null;
  }

  /**
   * Keeps a report of mocked fixes from the caller's phone (BR-50), and flags their waiting
   * submissions captured in the 30 days after it, unless the tenant switched the check off.
   */
  async report(
    tx: TenantTx,
    access: Access,
    body: MockLocationReportBody,
  ): Promise<MockLocationReportResult> {
    const tenantId = access.tenantId;
    const settings = await this.config.settings(tx, tenantId);
    const seenAt = Date.parse(body.seenAt);
    const now = Date.now();
    if (seenAt > now + FUTURE_TOLERANCE_MS) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', [
        { path: 'seenAt', issue: 'This time is in the future' },
      ]);
    }
    if (seenAt < now - settings.syncWindowHours * HOUR_MS) {
      throw new AppError('SYNC_WINDOW', 'This was seen too long ago to count.', [
        { path: 'seenAt', issue: 'This was seen too long ago to count' },
      ]);
    }
    await tx.insert(mockLocationReports).values({
      tenantId,
      id: body.id,
      userId: access.userId,
      deviceId: access.deviceId,
      seenAt: new Date(seenAt),
      source: body.source,
      count: body.count,
    });
    if (!settings.anomalyFlagsOff.includes('mock_history')) {
      const waiting = await tx
        .select({ id: submissions.id })
        .from(submissions)
        .where(
          and(
            eq(submissions.tenantId, tenantId),
            eq(submissions.userId, access.userId),
            eq(submissions.status, 'pending'),
            gte(submissions.capturedAt, new Date(seenAt)),
            lte(submissions.capturedAt, new Date(seenAt + MOCK_HISTORY_DAYS * DAY_MS)),
          ),
        );
      await this.flagWaiting(
        tx,
        tenantId,
        waiting.map((row) => row.id),
        'mock_history',
        { source: body.source, lastSeenAt: new Date(seenAt).toISOString() },
      );
    }
    return {
      id: body.id,
      seenAt: new Date(seenAt).toISOString(),
      source: body.source,
      count: body.count,
    };
  }

  /** Removes reports older than 90 days (BR-50); returns how many. */
  async purge(tx: TenantTx, tenantId: string, now: Date = new Date()): Promise<number> {
    const gone = await tx
      .delete(mockLocationReports)
      .where(
        and(
          eq(mockLocationReports.tenantId, tenantId),
          lt(mockLocationReports.seenAt, new Date(now.getTime() - MOCK_REPORT_KEEP_DAYS * DAY_MS)),
        ),
      )
      .returning({ id: mockLocationReports.id });
    return gone.length;
  }
}
