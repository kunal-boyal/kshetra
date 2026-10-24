import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  AppError,
  type ApprovalSubject,
  type CreateLeaveRequestBody,
  datesBetween,
  type DayLeave,
  issueAt,
  type LeaveBalance,
  leaveBalance,
  leaveDays,
  type LeaveIssue,
  leaveIssues,
  type LeaveRequestListQuery,
  type LeaveRequestResult,
  type LeaveType,
  quotaYear,
  todayIn,
} from '@thelamp/shared';
import { and, asc, eq, gte, inArray, lte, ne, type SQL, sql } from 'drizzle-orm';
import { leaveRequests } from '../../db/schema/leave';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AttendanceLeave } from '../field/attendance-leave';
import { AttendanceService } from '../field/attendance.service';
import { CalendarsService, offOn } from '../field/calendars.service';
import { notFound, outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { PhotosService } from '../media/photos.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { ApprovalsService } from '../workflow/approvals.service';
import { RequestTypes } from '../workflow/request-types';
import { LeaveTypesService } from './leave-types.service';

type Row = typeof leaveRequests.$inferSelect;

const OPEN = ['pending', 'approved'];

/** What each issue says beside its field (spec 11.1). */
const SAYS: Record<LeaveIssue['issue'], string> = {
  inactive_type: 'This leave type is switched off',
  end_before_start: 'End on or after the first day',
  too_long: 'Ask for a year or less at a time',
  half_day_not_allowed: 'This leave type has no half days',
  half_day_one_day: 'A half day is one day; make the first and last day the same',
  no_working_days: 'These days are all weekly offs or holidays',
  attachment_required: 'Attach a document for leave this long',
  overlap: 'You have leave on some of these days already',
  quota: 'This is more than the days left this year',
};

/**
 * Leave requests (M13, BR-27, decision D81): a person asks for leave of a type over a range of
 * days; the working days of their calendar count, within the type's quota for the start date's
 * quota year, never overlapping another waiting or approved request. It runs through the `leave`
 * chain; approved leave makes those working days paid or unpaid leave in attendance (BR-23).
 */
@Injectable()
export class LeaveRequestsService implements OnModuleInit {
  constructor(
    private readonly types: LeaveTypesService,
    private readonly approvals: ApprovalsService,
    private readonly requestTypes: RequestTypes,
    private readonly attendance: AttendanceService,
    private readonly attendanceLeave: AttendanceLeave,
    private readonly calendars: CalendarsService,
    private readonly people: People,
    private readonly scopes: Scopes,
    private readonly photos: PhotosService,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {}

  onModuleInit(): void {
    this.requestTypes.register({
      type: 'leave',
      fallbackPermission: 'approval.act',
      bulk: true,
      subjects: (tx, tenantId, ids) => this.subjects(tx, tenantId, ids),
      decided: async (tx, by, id, outcome) => {
        const [row] = await tx
          .update(leaveRequests)
          .set({ state: outcome, decidedAt: new Date() })
          .where(and(eq(leaveRequests.tenantId, by.tenantId), eq(leaveRequests.id, id)))
          .returning();
        if (!row) return;
        await this.audit.record(tx, by.tenantId, userActor(by), {
          action: 'leave.decided',
          target: { type: 'leave_request', id },
          after: { state: row.state },
        });
        // Days already gone follow, for reports; the rest are worked out as they come.
        const { timezone } = await this.config.settings(tx, by.tenantId);
        const today = todayIn(timezone);
        if (row.startDate <= today) {
          const to = row.endDate < today ? row.endDate : today;
          await this.attendance.store(tx, by.tenantId, [row.userId], row.startDate, to);
        }
      },
    });
    this.attendanceLeave.provide({
      days: (tx, tenantId, userIds, from, to) => this.approvedDays(tx, tenantId, userIds, from, to),
    });
  }

  /** `POST /v1/leave-requests`: asks for leave for the caller (BR-27). */
  async create(
    tx: TenantTx,
    access: Access,
    body: CreateLeaveRequestBody,
  ): Promise<LeaveRequestResult> {
    const { tenantId, userId } = access;
    const type = await this.types.find(tx, tenantId, body.leaveType);
    if (!type) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', [
        issueAt(['leaveType'], 'There is no leave type with this key'),
      ]);
    }
    // One request at a time for a person, so two can't both pass the overlap and quota checks.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`leave:${tenantId}:${userId}`}, 0))`,
    );
    const days =
      body.endDate < body.startDate ? 0 : await this.countDays(tx, tenantId, userId, body);
    const settings = await this.config.settings(tx, tenantId);
    const year = quotaYear(body.startDate, type.quotaYear, settings.financialYearStartMonth);
    const issues = leaveIssues({
      start: body.startDate,
      end: body.endDate,
      halfDay: body.halfDay,
      days,
      hasAttachment: body.attachmentId !== undefined,
      type,
      used: await this.used(tx, tenantId, userId, type.key, year),
      overlaps: body.endDate >= body.startDate && (await this.overlaps(tx, tenantId, userId, body)),
    });
    if (issues.length > 0) {
      const code = issues.find((issue) => issue.code !== 'VALIDATION')?.code ?? 'VALIDATION';
      throw new AppError(
        code,
        code === 'QUOTA_EXCEEDED'
          ? 'This is more leave than you have left this year.'
          : code === 'CONFLICT'
            ? 'You have leave on some of these days already.'
            : 'Check the highlighted fields.',
        issues.map((issue) => issueAt([issue.path], SAYS[issue.issue])),
      );
    }
    if (body.attachmentId) {
      await this.photos.attachable(tx, access, body.attachmentId, 'attachment');
    }
    await tx.insert(leaveRequests).values({
      id: body.id,
      tenantId,
      userId,
      leaveTypeKey: type.key,
      startDate: body.startDate,
      endDate: body.endDate,
      halfDay: body.halfDay,
      days: String(days),
      reason: body.reason || null,
      attachmentId: body.attachmentId ?? null,
    });
    if (body.attachmentId) {
      await this.photos.attach(tx, tenantId, [body.attachmentId], {
        type: 'leave_request',
        id: body.id,
      });
    }
    const approvalId = await this.approvals.request(
      tx,
      tenantId,
      userId,
      'leave',
      body.id,
      userActor(access),
      { facts: { leave_days: days, paid: type.paid } },
    );
    await tx
      .update(leaveRequests)
      .set({ workflowInstanceId: approvalId })
      .where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.id, body.id)));
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'leave.requested',
      target: { type: 'leave_request', id: body.id },
      after: {
        leaveType: type.key,
        startDate: body.startDate,
        endDate: body.endDate,
        halfDay: body.halfDay,
        days,
      },
    });
    return this.result(tx, tenantId, await this.row(tx, tenantId, body.id));
  }

  /** `GET /v1/leave-requests`: a person's requests starting in a year, theirs or someone they reach. */
  async list(
    tx: TenantTx,
    access: Access,
    query: LeaveRequestListQuery,
  ): Promise<{ items: LeaveRequestResult[] }> {
    const userId = await this.whose(tx, access, query.userId);
    const { timezone } = await this.config.settings(tx, access.tenantId);
    const year = query.year ?? Number(todayIn(timezone).slice(0, 4));
    const rows = await tx
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.tenantId, access.tenantId),
          eq(leaveRequests.userId, userId),
          gte(leaveRequests.startDate, `${year}-01-01`),
          lte(leaveRequests.startDate, `${year}-12-31`),
        ),
      )
      .orderBy(asc(leaveRequests.startDate), asc(leaveRequests.createdAt));
    return { items: await Promise.all(rows.map((row) => this.result(tx, access.tenantId, row))) };
  }

  /** `GET /v1/leave-balances`: each active type's balance in the quota year of a day. */
  async balances(
    tx: TenantTx,
    access: Access,
    query: { userId?: string | undefined; on?: string | undefined },
  ): Promise<{ userId: string; on: string; items: LeaveBalance[] }> {
    const userId = await this.whose(tx, access, query.userId);
    const settings = await this.config.settings(tx, access.tenantId);
    const on = query.on ?? todayIn(settings.timezone);
    const types = (await this.types.list(tx, access.tenantId)).filter((type) => type.active);
    const items = await Promise.all(
      types.map(async (type) => {
        const year = quotaYear(on, type.quotaYear, settings.financialYearStartMonth);
        const [approved, pending] = await Promise.all([
          this.used(tx, access.tenantId, userId, type.key, year, ['approved']),
          this.used(tx, access.tenantId, userId, type.key, year, ['pending']),
        ]);
        return {
          leaveType: type.key,
          ...year,
          ...leaveBalance(type.annualQuota, approved, pending),
        };
      }),
    );
    return { userId, on, items };
  }

  /**
   * The leave register (M18): requests overlapping a range by the people a subquery selects, in
   * date order, a page at a time.
   */
  async register(
    tx: TenantTx,
    tenantId: string,
    people: SQL,
    from: string,
    to: string,
    offset: number,
    limit: number,
  ) {
    return tx
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.tenantId, tenantId),
          sql`${leaveRequests.userId} in (${people})`,
          lte(leaveRequests.startDate, to),
          gte(leaveRequests.endDate, from),
        ),
      )
      .orderBy(asc(leaveRequests.startDate), asc(leaveRequests.userId), asc(leaveRequests.id))
      .offset(offset)
      .limit(limit + 1);
  }

  /** The working days a range counts on the person's calendar (BR-27). */
  private async countDays(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    range: { startDate: string; endDate: string; halfDay: boolean },
  ): Promise<number> {
    const [person] = await this.people.employment(tx, tenantId, [userId]);
    const calendars = await this.calendars.forPeople(
      tx,
      tenantId,
      [{ id: userId, calendarKey: person?.calendarKey ?? null }],
      range.startDate,
      range.endDate,
    );
    const calendar = calendars.get(userId)!;
    return leaveDays(
      { start: range.startDate, end: range.endDate, halfDay: range.halfDay },
      (date) => {
        const off = offOn(calendar, date);
        return off.weeklyOff || off.holiday !== null;
      },
    );
  }

  /** Days of a type waiting or approved (or the states named) that start in a quota year. */
  private async used(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    leaveType: string,
    year: { from: string; to: string },
    states: readonly string[] = OPEN,
  ): Promise<number> {
    const [row] = await tx
      .select({ days: sql<string | null>`sum(${leaveRequests.days})` })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.tenantId, tenantId),
          eq(leaveRequests.userId, userId),
          eq(leaveRequests.leaveTypeKey, leaveType),
          inArray(leaveRequests.state, [...states]),
          gte(leaveRequests.startDate, year.from),
          lte(leaveRequests.startDate, year.to),
        ),
      );
    return Number(row?.days ?? 0);
  }

  private async overlaps(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    range: { id: string; startDate: string; endDate: string },
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.tenantId, tenantId),
          eq(leaveRequests.userId, userId),
          ne(leaveRequests.id, range.id),
          inArray(leaveRequests.state, OPEN),
          lte(leaveRequests.startDate, range.endDate),
          gte(leaveRequests.endDate, range.startDate),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * Approved leave by person and working day, for attendance (BR-23): a day off on the person's
   * calendar stays a holiday or weekly off, as BR-27 never counted it.
   */
  private async approvedDays(
    tx: TenantTx,
    tenantId: string,
    userIds: readonly string[],
    from: string,
    to: string,
  ): Promise<Map<string, Map<string, DayLeave>>> {
    const result = new Map<string, Map<string, DayLeave>>();
    if (userIds.length === 0) return result;
    const rows = await tx
      .select({
        userId: leaveRequests.userId,
        leaveType: leaveRequests.leaveTypeKey,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        halfDay: leaveRequests.halfDay,
      })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.tenantId, tenantId),
          inArray(leaveRequests.userId, [...userIds]),
          eq(leaveRequests.state, 'approved'),
          lte(leaveRequests.startDate, to),
          gte(leaveRequests.endDate, from),
        ),
      );
    if (rows.length === 0) return result;
    const paid = new Map(
      (await this.types.list(tx, tenantId)).map((type: LeaveType) => [type.key, type.paid]),
    );
    const employment = await this.people.employment(tx, tenantId, [
      ...new Set(rows.map((row) => row.userId)),
    ]);
    const calendars = await this.calendars.forPeople(tx, tenantId, employment, from, to);
    for (const row of rows) {
      const calendar = calendars.get(row.userId);
      const days = result.get(row.userId) ?? new Map<string, DayLeave>();
      const start = row.startDate > from ? row.startDate : from;
      const end = row.endDate < to ? row.endDate : to;
      for (const date of datesBetween(start, end)) {
        const off = calendar ? offOn(calendar, date) : { weeklyOff: false, holiday: null };
        if (off.weeklyOff || off.holiday !== null) continue;
        days.set(date, { paid: paid.get(row.leaveType) ?? false, half: row.halfDay });
      }
      result.set(row.userId, days);
    }
    return result;
  }

  /** The person a read is about: the caller, or someone in their scope. */
  private async whose(tx: TenantTx, access: Access, userId: string | undefined): Promise<string> {
    const asked = userId ?? access.userId;
    if (asked !== access.userId && !(await this.scopes.reaches(tx, access, asked))) {
      throw outOfScope();
    }
    return asked;
  }

  private async row(tx: TenantTx, tenantId: string, id: string): Promise<Row> {
    const [row] = await tx
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.id, id)));
    if (!row) throw notFound();
    return row;
  }

  async result(tx: TenantTx, tenantId: string, row: Row): Promise<LeaveRequestResult> {
    return {
      id: row.id,
      userId: row.userId,
      leaveType: row.leaveTypeKey,
      startDate: row.startDate,
      endDate: row.endDate,
      halfDay: row.halfDay,
      days: Number(row.days),
      reason: row.reason,
      attachmentId: row.attachmentId,
      state: row.state as LeaveRequestResult['state'],
      approval: row.workflowInstanceId
        ? await this.approvals.forOwner(tx, tenantId, row.workflowInstanceId)
        : null,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
    };
  }

  /** What each request is about, for the approvals inbox: its dates. */
  private async subjects(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, ApprovalSubject>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({
        id: leaveRequests.id,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
      })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.tenantId, tenantId), inArray(leaveRequests.id, [...ids])));
    return new Map(
      rows.map((row) => [
        row.id,
        {
          title:
            row.startDate === row.endDate ? row.startDate : `${row.startDate} – ${row.endDate}`,
          accountId: null,
        },
      ]),
    );
  }
}
