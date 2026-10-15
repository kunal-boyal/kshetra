import { Injectable } from '@nestjs/common';
import type { DayVisit } from '@kshetra/metrics';
import {
  AppError,
  type CheckOutBody,
  clockSkewed,
  evidenceIssues,
  geofenceResult,
  type StartVisitBody,
  type VisitResult,
} from '@kshetra/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { accounts, accountTypes } from '../../db/schema/accounts';
import { submissions, visits } from '../../db/schema/field';
import { type AuditActor, AuditLog, SYSTEM_ACTOR, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { pointOf, pointSql } from '../../platform/geo';
import { onLocalDate } from '../../platform/local-day';
import { Outbox } from '../../platform/outbox';
import { AccountsService } from '../accounts/accounts.service';
import { clockSkewSeconds } from '../iam/devices.service';
import { notFound, outOfScope } from '../iam/actor';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { refuseEvidence, refuseOutsideGeofence } from './evidence';
import { PlanningService } from '../planning/planning.service';
import { ShiftsService } from './shifts.service';

/** A visit with no check-in or submission for this long checks out by itself (M6). */
export const VISIT_IDLE_MS = 4 * 3_600_000;

type EndReason = NonNullable<VisitResult['endReason']>;

/**
 * Visits (M6): checking in at an account with a fresh fix judged against its geofence (BR-33),
 * and checking out, by the person or for them when they check in elsewhere, punch out, or leave a
 * visit idle for 4 hours. Each check-in is judged by when the phone took it, so one sent later
 * from offline counts as it happened.
 */
@Injectable()
export class VisitsService {
  constructor(
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
    private readonly config: TenantConfigService,
    private readonly accounts: AccountsService,
    private readonly shifts: ShiftsService,
    private readonly planning: PlanningService,
  ) {}

  async view(tx: TenantTx, tenantId: string, id: string): Promise<VisitResult> {
    const [row] = await tx
      .select({
        id: visits.id,
        userId: visits.userId,
        shiftId: visits.shiftId,
        accountId: accounts.id,
        accountCode: accounts.code,
        accountName: accounts.name,
        checkInAt: visits.checkInAt,
        location: pointOf(visits.checkInPoint),
        accuracy: visits.checkInAccuracy,
        distanceM: visits.distanceM,
        geofence: visits.geofence,
        checkOutAt: visits.checkOutAt,
        endReason: visits.endReason,
        planItemId: visits.planItemId,
        clockSkew: visits.clockSkew,
      })
      .from(visits)
      .innerJoin(
        accounts,
        and(eq(accounts.tenantId, visits.tenantId), eq(accounts.id, visits.accountId)),
      )
      .where(and(eq(visits.tenantId, tenantId), eq(visits.id, id)));
    if (!row) throw notFound();
    return {
      id: row.id,
      userId: row.userId,
      shiftId: row.shiftId,
      account: { id: row.accountId, code: row.accountCode, name: row.accountName },
      checkedInAt: row.checkInAt.toISOString(),
      location: row.location!,
      accuracy: row.accuracy,
      distanceM: row.distanceM,
      geofence: row.geofence,
      checkedOutAt: row.checkOutAt?.toISOString() ?? null,
      endReason: row.endReason,
      planItemId: row.planItemId,
      flags: row.clockSkew ? ['clock_skew'] : [],
    };
  }

  /** The caller's own visit, for a record made in it; another person's is out of scope. */
  async own(tx: TenantTx, access: Access, id: string, lock = false) {
    const query = tx
      .select({
        id: visits.id,
        userId: visits.userId,
        shiftId: visits.shiftId,
        accountId: visits.accountId,
        checkInAt: visits.checkInAt,
        checkOutAt: visits.checkOutAt,
      })
      .from(visits)
      .where(and(eq(visits.tenantId, access.tenantId), eq(visits.id, id)));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw notFound();
    if (row.userId !== access.userId) throw outOfScope();
    return row;
  }

  /** The caller's open visit, if any. */
  async current(tx: TenantTx, access: Access): Promise<VisitResult | null> {
    const [open] = await tx
      .select({ id: visits.id })
      .from(visits)
      .where(
        and(
          eq(visits.tenantId, access.tenantId),
          eq(visits.userId, access.userId),
          isNull(visits.checkOutAt),
        ),
      );
    return open ? this.view(tx, access.tenantId, open.id) : null;
  }

  /**
   * Check in (M6): an active account the caller sees (BR-34), a fix that passes BR-32 on the
   * caller's shift, and inside the geofence when the account type requires it (BR-33). A visit
   * still open checks out at this check-in.
   */
  async checkIn(
    tx: TenantTx,
    access: Access,
    body: StartVisitBody,
    deviceTime: string | undefined,
  ): Promise<VisitResult> {
    if (!access.deviceId) {
      throw new AppError('USE_MOBILE_APP', 'Visits start in the mobile app.');
    }
    const tenantId = access.tenantId;
    const now = Date.now();
    const account = await this.accounts.forCapture(tx, access, body.accountId, body.fix.location);
    if (account.status !== 'active') {
      throw new AppError('VALIDATION', 'Visits are only to active accounts.', [
        { path: 'accountId', issue: 'This account is not active' },
      ]);
    }
    const settings = await this.config.settings(tx, tenantId);
    const at = Date.parse(body.checkedInAt);
    const shift = await this.shifts.at(tx, tenantId, access.userId, at);
    refuseEvidence(
      evidenceIssues(
        { capturedAt: at, fix: { ...body.fix, capturedAt: Date.parse(body.fix.capturedAt) } },
        shift,
        {
          userId: access.userId,
          now,
          maxShiftHours: settings.maxShiftHours,
          syncWindowHours: settings.syncWindowHours,
          offShiftAllowed: false,
        },
      ).map((issue) => (issue.path === 'capturedAt' ? { ...issue, path: 'checkedInAt' } : issue)),
    );
    const geofence = geofenceResult({
      distanceM: account.distanceM,
      radiusM: account.radiusM,
      accuracyM: body.fix.accuracy,
      accuracyCapM: account.accuracyCapM,
    });
    if (account.policy === 'required' && geofence === 'outside') {
      refuseOutsideGeofence(account.distanceM, account.radiusM);
    }
    const [open] = await tx
      .select({ id: visits.id, checkInAt: visits.checkInAt })
      .from(visits)
      .where(
        and(
          eq(visits.tenantId, tenantId),
          eq(visits.userId, access.userId),
          isNull(visits.checkOutAt),
        ),
      )
      .for('update');
    if (open) {
      await this.close(tx, tenantId, open.id, SYSTEM_ACTOR, {
        at: new Date(Math.max(at, open.checkInAt.getTime())),
        reason: 'next_check_in',
      });
    }
    await tx.insert(visits).values({
      id: body.id,
      tenantId,
      userId: access.userId,
      shiftId: shift!.id,
      accountId: account.id,
      planItemId: body.planItemId ?? null,
      deviceId: access.deviceId,
      checkInAt: new Date(at),
      checkInPoint: pointSql(body.fix.location),
      checkInAccuracy: body.fix.accuracy,
      distanceM: account.distanceM === null ? null : Math.round(account.distanceM),
      geofence,
      clockSkew: clockSkewed(clockSkewSeconds(deviceTime, new Date(now))),
    });
    // BR-34, BR-35: a visit from a plan item must carry out the person's own, at this account.
    if (body.planItemId) {
      await this.planning.startVisit(tx, access, body.planItemId, account.id, body.id);
    }
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'visit.checked_in',
      target: { type: 'visit', id: body.id },
      before: null,
      after: { accountId: account.id, checkedInAt: body.checkedInAt, geofence },
    });
    await this.outbox.publish(tx, tenantId, 'visit.started', body.id, {
      visitId: body.id,
      userId: access.userId,
      accountId: account.id,
      checkInAt: new Date(at).toISOString(),
      checkOutAt: null,
    });
    return this.view(tx, tenantId, body.id);
  }

  /** Check out. A visit that has ended already is returned as it is. */
  async checkOut(
    tx: TenantTx,
    access: Access,
    id: string,
    body: CheckOutBody,
  ): Promise<VisitResult> {
    const visit = await this.own(tx, access, id, true);
    if (visit.checkOutAt) return this.view(tx, access.tenantId, id);
    const at = Date.parse(body.checkedOutAt);
    if (at < visit.checkInAt.getTime()) {
      throw new AppError('VALIDATION', 'A visit ends after it starts.', [
        { path: 'checkedOutAt', issue: 'Use a time after the check-in' },
      ]);
    }
    await this.close(tx, access.tenantId, id, userActor(access), {
      at: new Date(at),
      reason: 'check_out',
      ...(body.fix ? { point: body.fix.location, accuracy: body.fix.accuracy } : {}),
    });
    return this.view(tx, access.tenantId, id);
  }

  private async close(
    tx: TenantTx,
    tenantId: string,
    id: string,
    actor: AuditActor,
    end: { at: Date; reason: EndReason; point?: { lat: number; lng: number }; accuracy?: number },
  ): Promise<void> {
    const [row] = await tx
      .update(visits)
      .set({
        checkOutAt: end.at,
        endReason: end.reason,
        ...(end.point ? { checkOutPoint: pointSql(end.point) } : {}),
        ...(end.accuracy !== undefined ? { checkOutAccuracy: end.accuracy } : {}),
      })
      .where(and(eq(visits.tenantId, tenantId), eq(visits.id, id), isNull(visits.checkOutAt)))
      .returning({
        userId: visits.userId,
        accountId: visits.accountId,
        checkInAt: visits.checkInAt,
      });
    if (!row) return;
    await this.audit.record(tx, tenantId, actor, {
      action: 'visit.checked_out',
      target: { type: 'visit', id },
      before: { checkedOutAt: null },
      after: { checkedOutAt: end.at.toISOString(), endReason: end.reason },
    });
    await this.outbox.publish(tx, tenantId, 'visit.ended', id, {
      visitId: id,
      userId: row.userId,
      accountId: row.accountId,
      checkInAt: row.checkInAt.toISOString(),
      checkOutAt: end.at.toISOString(),
    });
  }

  /** Punching out checks out of the visit open on that shift, at the punch-out (M6). */
  async closeForShift(
    tx: TenantTx,
    tenantId: string,
    shiftId: string,
    endedAt: Date,
  ): Promise<void> {
    const open = await tx
      .select({ id: visits.id, checkInAt: visits.checkInAt })
      .from(visits)
      .where(
        and(eq(visits.tenantId, tenantId), eq(visits.shiftId, shiftId), isNull(visits.checkOutAt)),
      )
      .for('update');
    for (const visit of open) {
      await this.close(tx, tenantId, visit.id, SYSTEM_ACTOR, {
        at: new Date(Math.max(endedAt.getTime(), visit.checkInAt.getTime())),
        reason: 'punch_out',
      });
    }
  }

  /**
   * Visits with nothing recorded for 4 hours check out 4 hours after their last check-in or
   * submission, `idle` (M6). Returns how many it closed.
   */
  /** One person's visits checked in on a date on the tenant's clock, for the metric engine. */
  async forMetrics(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    date: string,
    timezone: string,
  ): Promise<DayVisit[]> {
    const rows = await tx
      .select({
        accountId: accounts.id,
        typeKey: accountTypes.key,
        segments: accounts.segments,
        checkInAt: visits.checkInAt,
        checkOutAt: visits.checkOutAt,
      })
      .from(visits)
      .innerJoin(
        accounts,
        and(eq(accounts.tenantId, visits.tenantId), eq(accounts.id, visits.accountId)),
      )
      .innerJoin(
        accountTypes,
        and(eq(accountTypes.tenantId, accounts.tenantId), eq(accountTypes.id, accounts.typeId)),
      )
      .where(
        and(
          eq(visits.tenantId, tenantId),
          eq(visits.userId, userId),
          onLocalDate(visits.checkInAt, date, timezone),
        ),
      );
    return rows.map((row) => ({
      account: { id: row.accountId, typeKey: row.typeKey, segments: row.segments },
      checkInAt: row.checkInAt.toISOString(),
      checkOutAt: row.checkOutAt?.toISOString() ?? null,
    }));
  }

  async closeIdle(tx: TenantTx, tenantId: string, now: Date = new Date()): Promise<number> {
    const lastActivity = sql<Date>`greatest(${visits.checkInAt}, (
      select max(s.captured_at) from ${submissions} s
       where s.tenant_id = ${visits.tenantId} and s.visit_id = ${visits.id}))`;
    const idle = await tx
      .select({ id: visits.id, lastActivity: lastActivity.mapWith((value) => new Date(value)) })
      .from(visits)
      .where(
        and(
          eq(visits.tenantId, tenantId),
          isNull(visits.checkOutAt),
          sql`${lastActivity} < ${new Date(now.getTime() - VISIT_IDLE_MS)}`,
        ),
      )
      .for('update');
    for (const visit of idle) {
      await this.close(tx, tenantId, visit.id, SYSTEM_ACTOR, {
        at: new Date(visit.lastActivity.getTime() + VISIT_IDLE_MS),
        reason: 'idle',
      });
    }
    return idle.length;
  }
}
