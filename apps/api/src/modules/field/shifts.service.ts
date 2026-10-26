import { Injectable } from '@nestjs/common';
import {
  AppError,
  clockSkewed,
  type EndShiftBody,
  onDutyMs,
  type PauseShiftBody,
  POINT_EARLY_MS,
  punchFixIssue,
  type ResumeShiftBody,
  type ShiftListQuery,
  type ShiftListResult,
  type ShiftResult,
  type ShiftWindow,
  type StartShiftBody,
} from '@thelamp/shared';
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, type SQL, sql } from 'drizzle-orm';
import {
  locationPoints,
  shiftPauses,
  shifts,
  shiftTrails,
  userLastPosition,
} from '../../db/schema/field';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { pointOf, pointSql } from '../../platform/geo';
import { onLocalDate } from '../../platform/local-day';
import { Outbox } from '../../platform/outbox';
import { clockSkewSeconds } from '../iam/devices.service';
import { notFound, outOfScope } from '../iam/actor';
import { Scopes } from '../iam/scopes';
import { PhotosService } from '../media/photos.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

type ShiftRow = Awaited<ReturnType<ShiftsService['rows']>>[number];

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/**
 * Shifts (M5): punching in and out from the phone, pausing tracking, and the nightly close of
 * shifts left open past the longest a shift may last. Each punch is judged by when the phone
 * took it, so one sent later from offline counts as it happened (spec 11.3).
 */
@Injectable()
export class ShiftsService {
  constructor(
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
    private readonly config: TenantConfigService,
    private readonly scopes: Scopes,
    private readonly photos: PhotosService,
  ) {}

  private rows(tx: TenantTx, tenantId: string, where: ReturnType<typeof and>) {
    return tx
      .select({
        id: shifts.id,
        userId: shifts.userId,
        startedAt: shifts.startedAt,
        startLocation: pointOf(shifts.startPoint),
        startAccuracy: shifts.startAccuracy,
        consentVersion: shifts.consentVersion,
        selfieMediaId: shifts.selfieMediaId,
        endedAt: shifts.endedAt,
        endLocation: pointOf(shifts.endPoint),
        endAccuracy: shifts.endAccuracy,
        endReason: shifts.endReason,
        distanceM: shifts.distanceM,
        onDutySeconds: shifts.onDutySeconds,
        clockSkew: shifts.clockSkew,
      })
      .from(shifts)
      .where(and(eq(shifts.tenantId, tenantId), where));
  }

  /** Shifts as the API gives them, with their pauses. */
  private async views(tx: TenantTx, tenantId: string, rows: ShiftRow[]): Promise<ShiftResult[]> {
    const pauses =
      rows.length === 0
        ? []
        : await tx
            .select()
            .from(shiftPauses)
            .where(
              and(
                eq(shiftPauses.tenantId, tenantId),
                inArray(
                  shiftPauses.shiftId,
                  rows.map((row) => row.id),
                ),
              ),
            )
            .orderBy(asc(shiftPauses.pausedAt));
    return rows.map(({ clockSkew, ...row }) => ({
      ...row,
      startLocation: row.startLocation!,
      startedAt: row.startedAt.toISOString(),
      endedAt: iso(row.endedAt),
      pauses: pauses
        .filter((pause) => pause.shiftId === row.id)
        .map((pause) => ({
          id: pause.id,
          pausedAt: pause.pausedAt.toISOString(),
          resumedAt: iso(pause.resumedAt),
          reason: pause.reason,
        })),
      flags: clockSkew ? ['clock_skew' as const] : [],
    }));
  }

  async view(tx: TenantTx, tenantId: string, id: string): Promise<ShiftResult> {
    const [row] = await this.rows(tx, tenantId, eq(shifts.id, id));
    if (!row) throw notFound();
    return (await this.views(tx, tenantId, [row]))[0]!;
  }

  /** The caller's own shift; another person's is out of scope, a missing one not found. */
  private async own(tx: TenantTx, access: Access, id: string) {
    const [row] = await tx
      .select({
        id: shifts.id,
        userId: shifts.userId,
        startedAt: shifts.startedAt,
        endedAt: shifts.endedAt,
      })
      .from(shifts)
      .where(and(eq(shifts.tenantId, access.tenantId), eq(shifts.id, id)))
      .for('update');
    if (!row) throw notFound();
    if (row.userId !== access.userId) throw outOfScope();
    return row;
  }

  private static fix(body: { accuracy: number; mocked: boolean }) {
    const issue = punchFixIssue(body);
    if (issue === 'GPS_MOCKED') {
      throw new AppError('GPS_MOCKED', 'This location is mocked. Turn off any app that fakes it.');
    }
    if (issue === 'GPS_INACCURATE') {
      throw new AppError(
        'GPS_INACCURATE',
        'This location is not accurate enough. Try again in the open.',
      );
    }
  }

  /** Records captured further back than the sync window can't count (spec 11.3). */
  private static inWindow(at: number, now: number, syncWindowHours: number) {
    if (at < now - syncWindowHours * 3_600_000) {
      throw new AppError('SYNC_WINDOW', 'This was captured too long ago to count.');
    }
  }

  /**
   * The person's shift a moment falls in, for judging a record against it (BR-32): the latest
   * that started by then, give or take the 5 s a punch may lag. Null when none had.
   */
  async at(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    moment: number,
  ): Promise<(ShiftWindow & { id: string }) | null> {
    const [row] = await tx
      .select({ id: shifts.id, startedAt: shifts.startedAt, endedAt: shifts.endedAt })
      .from(shifts)
      .where(
        and(
          eq(shifts.tenantId, tenantId),
          eq(shifts.userId, userId),
          lte(shifts.startedAt, new Date(moment + POINT_EARLY_MS)),
        ),
      )
      .orderBy(desc(shifts.startedAt))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      userId,
      startedAt: row.startedAt.getTime(),
      endedAt: row.endedAt?.getTime() ?? null,
    };
  }

  /** The caller's open shift, if any. */
  async current(tx: TenantTx, access: Access): Promise<ShiftResult | null> {
    const found = await this.rows(
      tx,
      access.tenantId,
      and(eq(shifts.userId, access.userId), isNull(shifts.endedAt)),
    );
    return found.length === 0 ? null : (await this.views(tx, access.tenantId, found))[0]!;
  }

  /**
   * Punch in (M5): a real fix of 250 m or better, the consent the person accepted, and a selfie
   * when the tenant asks for one. Only one shift is open per person: another punch-in while one
   * is open is ALREADY_PUNCHED_IN.
   */
  async start(
    tx: TenantTx,
    access: Access,
    body: StartShiftBody,
    deviceTime: string | undefined,
  ): Promise<ShiftResult> {
    if (!access.deviceId) {
      throw new AppError('USE_MOBILE_APP', 'Shifts start in the mobile app.');
    }
    const tenantId = access.tenantId;
    const settings = await this.config.settings(tx, tenantId);
    const now = Date.now();
    ShiftsService.fix(body);
    const startedAt = Date.parse(body.startedAt);
    ShiftsService.inWindow(startedAt, now, settings.syncWindowHours);
    if (settings.attendanceSelfie && !body.selfieMediaId) {
      throw new AppError('PHOTO_REQUIRED', 'Take a selfie to punch in.');
    }
    if (body.selfieMediaId) await this.photos.attachable(tx, access, body.selfieMediaId, 'selfie');
    const open = await tx
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(
          eq(shifts.tenantId, tenantId),
          eq(shifts.userId, access.userId),
          isNull(shifts.endedAt),
        ),
      );
    if (open.length > 0) {
      throw new AppError('ALREADY_PUNCHED_IN', 'A shift is open already. Punch out first.');
    }
    await tx.insert(shifts).values({
      id: body.id,
      tenantId,
      userId: access.userId,
      deviceId: access.deviceId,
      startedAt: new Date(startedAt),
      startPoint: pointSql(body.location),
      startAccuracy: body.accuracy,
      consentVersion: body.consentVersion,
      selfieMediaId: body.selfieMediaId ?? null,
      clockSkew: clockSkewed(clockSkewSeconds(deviceTime, new Date(now))),
    });
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'shift.started',
      target: { type: 'shift', id: body.id },
      before: null,
      after: { startedAt: body.startedAt, consentVersion: body.consentVersion },
    });
    await this.outbox.publish(tx, tenantId, 'shift.started', body.id, {
      shiftId: body.id,
      userId: access.userId,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: null,
    });
    return this.view(tx, tenantId, body.id);
  }

  /**
   * Punch out. A punch-out past the longest a shift may last ends it at that limit
   * (`max_length`); a shift that has ended already is returned as it is, so a punch-out queued
   * offline after the nightly close doesn't park.
   */
  async end(
    tx: TenantTx,
    access: Access,
    id: string,
    body: EndShiftBody,
    deviceTime: string | undefined,
  ): Promise<ShiftResult> {
    const tenantId = access.tenantId;
    const shift = await this.own(tx, access, id);
    if (shift.endedAt) return this.view(tx, tenantId, id);
    const settings = await this.config.settings(tx, tenantId);
    const now = Date.now();
    ShiftsService.fix(body);
    const endedAt = Date.parse(body.endedAt);
    if (endedAt < shift.startedAt.getTime()) {
      throw new AppError('VALIDATION', 'A shift ends after it starts.', [
        { path: 'endedAt', issue: 'Use a time after the shift started' },
      ]);
    }
    const limit = shift.startedAt.getTime() + settings.maxShiftHours * 3_600_000;
    const tooLong = endedAt > limit;
    const skewed = clockSkewed(clockSkewSeconds(deviceTime, new Date(now)));
    await this.close(tx, tenantId, id, {
      endedAt: new Date(tooLong ? limit : endedAt),
      reason: tooLong ? 'max_length' : 'punch_out',
      point: body.location,
      accuracy: body.accuracy,
      skewed,
    });
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'shift.ended',
      target: { type: 'shift', id },
      before: { endedAt: null },
      after: {
        endedAt: new Date(tooLong ? limit : endedAt).toISOString(),
        endReason: tooLong ? 'max_length' : 'punch_out',
      },
    });
    return this.view(tx, tenantId, id);
  }

  /** Ends a shift: open pauses end with it, time on duty is counted, and the event goes out. */
  private async close(
    tx: TenantTx,
    tenantId: string,
    id: string,
    end: {
      endedAt: Date;
      reason: 'punch_out' | 'auto_closed' | 'max_length' | 'admin';
      point?: { lat: number; lng: number };
      accuracy?: number;
      skewed?: boolean;
    },
  ): Promise<void> {
    await tx
      .update(shiftPauses)
      .set({ resumedAt: end.endedAt })
      .where(
        and(
          eq(shiftPauses.tenantId, tenantId),
          eq(shiftPauses.shiftId, id),
          isNull(shiftPauses.resumedAt),
        ),
      );
    const pauses = await tx
      .select({ pausedAt: shiftPauses.pausedAt, resumedAt: shiftPauses.resumedAt })
      .from(shiftPauses)
      .where(and(eq(shiftPauses.tenantId, tenantId), eq(shiftPauses.shiftId, id)));
    const [row] = await tx
      .select({ userId: shifts.userId, startedAt: shifts.startedAt })
      .from(shifts)
      .where(and(eq(shifts.tenantId, tenantId), eq(shifts.id, id)));
    const duty = onDutyMs(
      { startedAt: row!.startedAt.getTime(), endedAt: end.endedAt.getTime() },
      pauses.map((pause) => ({
        pausedAt: pause.pausedAt.getTime(),
        resumedAt: pause.resumedAt?.getTime() ?? null,
      })),
    );
    await tx
      .update(shifts)
      .set({
        endedAt: end.endedAt,
        endReason: end.reason,
        onDutySeconds: Math.round(duty / 1_000),
        ...(end.point ? { endPoint: pointSql(end.point) } : {}),
        ...(end.accuracy !== undefined ? { endAccuracy: end.accuracy } : {}),
        ...(end.skewed ? { clockSkew: true } : {}),
      })
      .where(and(eq(shifts.tenantId, tenantId), eq(shifts.id, id)));
    await this.outbox.publish(tx, tenantId, 'shift.ended', id, {
      shiftId: id,
      userId: row!.userId,
      startedAt: row!.startedAt.toISOString(),
      endedAt: end.endedAt.toISOString(),
    });
  }

  /** Pause tracking (M5): GPS stops, attendance doesn't. One pause at a time. */
  async pause(
    tx: TenantTx,
    access: Access,
    id: string,
    body: PauseShiftBody,
  ): Promise<ShiftResult> {
    const tenantId = access.tenantId;
    const shift = await this.own(tx, access, id);
    if (shift.endedAt) throw new AppError('NOT_ON_SHIFT', 'This shift has ended.');
    const pausedAt = Date.parse(body.pausedAt);
    if (pausedAt < shift.startedAt.getTime()) {
      throw new AppError('OUTSIDE_SHIFT', 'A pause starts after the shift does.');
    }
    const [existing] = await tx
      .select({ id: shiftPauses.id, shiftId: shiftPauses.shiftId })
      .from(shiftPauses)
      .where(and(eq(shiftPauses.tenantId, tenantId), eq(shiftPauses.id, body.id)));
    if (existing) {
      if (existing.shiftId !== id)
        throw new AppError('IDEMPOTENCY_CONFLICT', 'This pause is on another shift.');
      return this.view(tx, tenantId, id);
    }
    const open = await tx
      .select({ id: shiftPauses.id })
      .from(shiftPauses)
      .where(
        and(
          eq(shiftPauses.tenantId, tenantId),
          eq(shiftPauses.shiftId, id),
          isNull(shiftPauses.resumedAt),
        ),
      );
    if (open.length > 0) {
      throw new AppError('CONFLICT', 'Tracking is paused already. Resume it first.');
    }
    await tx.insert(shiftPauses).values({
      id: body.id,
      tenantId,
      shiftId: id,
      pausedAt: new Date(pausedAt),
      reason: body.reason,
    });
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'shift.paused',
      target: { type: 'shift', id },
      before: null,
      after: { pauseId: body.id, pausedAt: body.pausedAt, reason: body.reason },
    });
    return this.view(tx, tenantId, id);
  }

  /** Resume tracking. Resuming a pause that has ended already returns the shift as it is. */
  async resume(
    tx: TenantTx,
    access: Access,
    id: string,
    pauseId: string,
    body: ResumeShiftBody,
  ): Promise<ShiftResult> {
    const tenantId = access.tenantId;
    await this.own(tx, access, id);
    const [pause] = await tx
      .select()
      .from(shiftPauses)
      .where(
        and(
          eq(shiftPauses.tenantId, tenantId),
          eq(shiftPauses.shiftId, id),
          eq(shiftPauses.id, pauseId),
        ),
      )
      .for('update');
    if (!pause) throw notFound();
    if (pause.resumedAt) return this.view(tx, tenantId, id);
    const resumedAt = Date.parse(body.resumedAt);
    if (resumedAt < pause.pausedAt.getTime()) {
      throw new AppError('VALIDATION', 'Tracking resumes after it paused.', [
        { path: 'resumedAt', issue: 'Use a time after the pause started' },
      ]);
    }
    await tx
      .update(shiftPauses)
      .set({ resumedAt: new Date(resumedAt) })
      .where(and(eq(shiftPauses.tenantId, tenantId), eq(shiftPauses.id, pauseId)));
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'shift.resumed',
      target: { type: 'shift', id },
      before: { pauseId, resumedAt: null },
      after: { pauseId, resumedAt: body.resumedAt },
    });
    return this.view(tx, tenantId, id);
  }

  /** A person's shifts, newest first, for those whose scope reaches them. */
  async list(tx: TenantTx, access: Access, query: ShiftListQuery): Promise<ShiftListResult> {
    if (query.userId !== access.userId && !(await this.scopes.reaches(tx, access, query.userId))) {
      throw outOfScope();
    }
    const [cursorAt, cursorId] = query.cursor ? query.cursor.split('|') : [];
    const found = await this.rows(
      tx,
      access.tenantId,
      and(
        eq(shifts.userId, query.userId),
        cursorAt && cursorId
          ? or(
              lt(shifts.startedAt, new Date(cursorAt)),
              and(eq(shifts.startedAt, new Date(cursorAt)), lt(shifts.id, cursorId)),
            )
          : undefined,
      ),
    )
      .orderBy(desc(shifts.startedAt), desc(shifts.id))
      .limit(query.limit + 1);
    const page = found.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: await this.views(tx, access.tenantId, page),
      nextCursor:
        found.length > query.limit && last ? `${last.startedAt.toISOString()}|${last.id}` : null,
    };
  }

  /**
   * The nightly close (M5): shifts open past the longest a shift may last end at that limit,
   * `auto_closed`. Returns how many it closed.
   */
  /**
   * Distance and pauses of some shifts, for the attendance register (M18): the distance the shift
   * kept when it ended, and its pauses, an open one counting until the shift ended or now.
   */
  /**
   * The location summary (M18): each shift of people among `people` that started from `from`
   * to `to`, with its trail's points, kept points and gaps, by start, a page at a time.
   */
  async summaryRows(
    tx: TenantTx,
    tenantId: string,
    people: SQL,
    from: Date,
    to: Date,
    offset: number,
    limit: number,
  ) {
    return tx
      .select({
        id: shifts.id,
        userId: shifts.userId,
        startedAt: shifts.startedAt,
        endedAt: shifts.endedAt,
        endReason: shifts.endReason,
        onDutySeconds: shifts.onDutySeconds,
        pointCount: shiftTrails.pointCount,
        keptCount: shiftTrails.keptCount,
        gaps: sql<number | null>`jsonb_array_length(${shiftTrails.gaps})`,
      })
      .from(shifts)
      .leftJoin(
        shiftTrails,
        and(eq(shiftTrails.tenantId, shifts.tenantId), eq(shiftTrails.shiftId, shifts.id)),
      )
      .where(
        and(
          eq(shifts.tenantId, tenantId),
          sql`${shifts.userId} in (${people})`,
          sql`${shifts.startedAt} >= ${from.toISOString()} and ${shifts.startedAt} < ${to.toISOString()}`,
        ),
      )
      .orderBy(asc(shifts.startedAt), asc(shifts.id))
      .offset(offset)
      .limit(limit + 1);
  }

  async reportFacts(
    tx: TenantTx,
    tenantId: string,
    shiftIds: readonly string[],
  ): Promise<Map<string, { distanceM: number | null; pauses: number; pausedSeconds: number }>> {
    if (shiftIds.length === 0) return new Map();
    const rows = await tx
      .select({
        id: shifts.id,
        distanceM: shifts.distanceM,
        pauses: sql<number>`count(${shiftPauses.id})::int`,
        pausedSeconds: sql<number>`coalesce(sum(extract(epoch from
          coalesce(${shiftPauses.resumedAt}, ${shifts.endedAt}, now()) - ${shiftPauses.pausedAt})), 0)::int`,
      })
      .from(shifts)
      .leftJoin(
        shiftPauses,
        and(eq(shiftPauses.tenantId, shifts.tenantId), eq(shiftPauses.shiftId, shifts.id)),
      )
      .where(and(eq(shifts.tenantId, tenantId), inArray(shifts.id, [...shiftIds])))
      .groupBy(shifts.id, shifts.distanceM);
    return new Map(
      rows.map((row) => [
        row.id,
        { distanceM: row.distanceM, pauses: row.pauses, pausedSeconds: row.pausedSeconds },
      ]),
    );
  }

  /**
   * Everyone on duty among some users, for the live map (M17): each open shift, whether it is
   * paused, and its newest position, if it has one.
   */
  async onDuty(tx: TenantTx, tenantId: string, userIds: SQL) {
    const rows = await tx
      .select({
        shiftId: shifts.id,
        userId: shifts.userId,
        startedAt: shifts.startedAt,
        paused: sql<boolean>`exists (select 1 from ${shiftPauses} where ${shiftPauses.tenantId} = ${shifts.tenantId}
          and ${shiftPauses.shiftId} = ${shifts.id} and ${shiftPauses.resumedAt} is null)`,
        position: pointOf(userLastPosition.point),
        accuracy: userLastPosition.accuracy,
        battery: userLastPosition.battery,
        seenAt: userLastPosition.capturedAt,
      })
      .from(shifts)
      .leftJoin(
        userLastPosition,
        and(
          eq(userLastPosition.tenantId, shifts.tenantId),
          eq(userLastPosition.userId, shifts.userId),
          eq(userLastPosition.shiftId, shifts.id),
        ),
      )
      .where(
        and(
          eq(shifts.tenantId, tenantId),
          isNull(shifts.endedAt),
          sql`${shifts.userId} in (${userIds})`,
        ),
      )
      .orderBy(asc(shifts.startedAt));
    return rows;
  }

  /** A person's shifts that started on a date on the tenant's clock, with their pauses (M17). */
  async ofDay(tx: TenantTx, tenantId: string, userId: string, date: string, timezone: string) {
    const rows = await tx
      .select({
        id: shifts.id,
        startedAt: shifts.startedAt,
        endedAt: shifts.endedAt,
        distanceM: shifts.distanceM,
      })
      .from(shifts)
      .where(
        and(
          eq(shifts.tenantId, tenantId),
          eq(shifts.userId, userId),
          onLocalDate(shifts.startedAt, date, timezone),
        ),
      )
      .orderBy(asc(shifts.startedAt));
    const pauses = rows.length
      ? await tx
          .select({
            shiftId: shiftPauses.shiftId,
            from: shiftPauses.pausedAt,
            to: shiftPauses.resumedAt,
          })
          .from(shiftPauses)
          .where(
            and(
              eq(shiftPauses.tenantId, tenantId),
              inArray(
                shiftPauses.shiftId,
                rows.map((row) => row.id),
              ),
            ),
          )
          .orderBy(asc(shiftPauses.pausedAt))
      : [];
    return rows.map((row) => ({
      ...row,
      pauses: pauses.filter((pause) => pause.shiftId === row.id),
    }));
  }

  /**
   * Open shifts, not paused, whose newest point is older than `minutes` (spec 12.1, M16): each
   * with the moment it went quiet, which names the gap, so it is reported once per gap. A shift
   * that has sent nothing yet goes quiet from its start or its last resume.
   */
  async silent(
    tx: TenantTx,
    tenantId: string,
    now: Date,
    minutes: number,
  ): Promise<{ shiftId: string; userId: string; since: Date }[]> {
    const lastResume = sql<Date | null>`(select max(${shiftPauses.resumedAt}) from ${shiftPauses}
      where ${shiftPauses.tenantId} = ${shifts.tenantId} and ${shiftPauses.shiftId} = ${shifts.id})`;
    const since = sql<Date>`greatest(${shifts.startedAt}, coalesce(${userLastPosition.capturedAt}, ${shifts.startedAt}), coalesce(${lastResume}, ${shifts.startedAt}))`;
    const rows = await tx
      .select({ shiftId: shifts.id, userId: shifts.userId, since })
      .from(shifts)
      .leftJoin(
        userLastPosition,
        and(
          eq(userLastPosition.tenantId, shifts.tenantId),
          eq(userLastPosition.userId, shifts.userId),
          eq(userLastPosition.shiftId, shifts.id),
        ),
      )
      .where(
        and(
          eq(shifts.tenantId, tenantId),
          isNull(shifts.endedAt),
          sql`not exists (select 1 from ${shiftPauses} where ${shiftPauses.tenantId} = ${shifts.tenantId}
            and ${shiftPauses.shiftId} = ${shifts.id} and ${shiftPauses.resumedAt} is null)`,
          sql`${since} < ${new Date(now.getTime() - minutes * 60_000).toISOString()}`,
        ),
      );
    return rows.map((row) => ({ ...row, since: new Date(row.since) }));
  }

  async autoClose(tx: TenantTx, tenantId: string, now: Date = new Date()): Promise<number> {
    const { maxShiftHours } = await this.config.settings(tx, tenantId);
    const stale = await tx
      .select({ id: shifts.id, startedAt: shifts.startedAt })
      .from(shifts)
      .where(
        and(
          eq(shifts.tenantId, tenantId),
          isNull(shifts.endedAt),
          sql`${shifts.startedAt} < ${new Date(now.getTime() - maxShiftHours * 3_600_000)}`,
        ),
      )
      .orderBy(desc(shifts.startedAt))
      .for('update');
    for (const shift of stale) {
      await this.close(tx, tenantId, shift.id, {
        endedAt: new Date(shift.startedAt.getTime() + maxShiftHours * 3_600_000),
        reason: 'auto_closed',
      });
    }
    return stale.length;
  }

  /**
   * An erased person's whereabouts (decision D95): every location point, route and last known
   * position goes; their shifts, with punch times, stay as the attendance record. Points already
   * archived to files go with those files' own retention.
   */
  async erasePerson(tx: TenantTx, tenantId: string, userId: string): Promise<number> {
    const points = await tx
      .delete(locationPoints)
      .where(and(eq(locationPoints.tenantId, tenantId), eq(locationPoints.userId, userId)))
      .returning({ id: locationPoints.id });
    await tx
      .delete(shiftTrails)
      .where(and(eq(shiftTrails.tenantId, tenantId), eq(shiftTrails.userId, userId)));
    await tx
      .delete(userLastPosition)
      .where(and(eq(userLastPosition.tenantId, tenantId), eq(userLastPosition.userId, userId)));
    return points.length;
  }
}
