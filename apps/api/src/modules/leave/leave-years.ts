import { Injectable, type OnModuleInit } from '@nestjs/common';
import { closeLeaveYear, leaveCredited, type LeaveType, quotaYear, todayIn } from '@thelamp/shared';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { leaveRequests, leaveYearClosings } from '../../db/schema/leave';
import { AuditLog, type AuditActor, SYSTEM_ACTOR } from '../../platform/audit';
import { Database, type TenantTx } from '../../platform/database';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { People } from '../iam/people';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { LeaveTypesService } from './leave-types.service';

const KIND = 'leave.close_years';
const DAY = 86_400_000;

type Year = { from: string; to: string };
type Closing = typeof leaveYearClosings.$inferSelect;

const dayBefore = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - DAY).toISOString().slice(0, 10);

/**
 * Accrual and carry-forward (spec 5.10, decision D114): what a person's leave type has credited by
 * a day, what came in from the year before, and the closing of each quota year that ended. Credits
 * are worked out from the type and the joining date; year ends are kept in
 * `cell.leave_year_closings` with the cap in force then, so later changes to the type never
 * rewrite them. Only types that carry days forward are closed.
 */
@Injectable()
export class LeaveYears implements OnModuleInit {
  constructor(
    private readonly database: Database,
    private readonly types: LeaveTypesService,
    private readonly people: People,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
  ) {}

  onModuleInit(): void {
    this.queues.handle('maintenance', KIND, async (data) => {
      await this.closeEnded(String(data.tenantId));
    });
    this.schedules.atTenantTime({
      name: 'leave_years',
      at: '00:40',
      queue: 'maintenance',
      kind: KIND,
    });
  }

  /** The quota year a day falls in, for a type, on the tenant's settings. */
  async yearOf(tx: TenantTx, tenantId: string, type: LeaveType, day: string): Promise<Year> {
    const { financialYearStartMonth } = await this.config.settings(tx, tenantId);
    return quotaYear(day, type.quotaYear, financialYearStartMonth);
  }

  /** The days of a type credited to a person by a day of a quota year. */
  async credited(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    type: LeaveType,
    year: Year,
    day: string,
  ): Promise<number> {
    const [person] = await this.people.employment(tx, tenantId, [userId]);
    return leaveCredited(type, year, day < year.to ? day : year.to, person?.joiningDate ?? null);
  }

  /** What the year before carried into this one: its closing's carried days, or none. */
  async carriedIn(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    type: LeaveType,
    year: Year,
  ): Promise<number> {
    const before = await this.closing(
      tx,
      tenantId,
      userId,
      type.key,
      (await this.yearOf(tx, tenantId, type, dayBefore(year.from))).from,
    );
    return before ? Number(before.carriedOut) : 0;
  }

  /**
   * What lapsed when a year ended: its closing's, or for a type that isn't closed, what was left
   * over the type's carry; nothing while the year runs.
   */
  async lapsed(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    type: LeaveType,
    year: Year,
    figures: { credited: number; carriedIn: number; taken: number },
    today: string,
  ): Promise<number> {
    if (year.to >= today) return 0;
    const closed = await this.closing(tx, tenantId, userId, type.key, year.from);
    if (closed) return Number(closed.lapsed);
    return closeLeaveYear({ ...figures, cap: type.carryForwardMax }).lapsed;
  }

  /**
   * Closes the quota year just ended for every active person and every active type that carries
   * days forward, once; running it again closes nothing more. The first closing of a type starts
   * from nothing carried in, so switching carry-forward on never reaches back.
   */
  async closeEnded(tenantId: string): Promise<number> {
    return this.database.forTenant(tenantId, async (tx) => {
      const { timezone } = await this.config.settings(tx, tenantId);
      const today = todayIn(timezone);
      const types = (await this.types.list(tx, tenantId)).filter(
        (type) => type.active && type.annualQuota > 0 && type.carryForwardMax > 0,
      );
      const people = await this.people.employment(tx, tenantId);
      let closed = 0;
      for (const type of types) {
        const current = await this.yearOf(tx, tenantId, type, today);
        const ended = await this.yearOf(tx, tenantId, type, dayBefore(current.from));
        for (const person of people) {
          if (person.joiningDate && person.joiningDate > ended.to) continue;
          if (await this.closing(tx, tenantId, person.id, type.key, ended.from)) continue;
          await this.write(tx, tenantId, person.id, type, ended, {
            credited: leaveCredited(type, ended, ended.to, person.joiningDate),
            carriedIn: await this.carriedIn(tx, tenantId, person.id, type, ended),
            cap: type.carryForwardMax,
          });
          closed += 1;
        }
      }
      if (closed > 0) {
        await this.audit.record(tx, tenantId, SYSTEM_ACTOR, {
          action: 'leave.years_closed',
          target: { type: 'leave_types', id: null },
          after: { closed },
        });
      }
      return closed;
    });
  }

  /**
   * After a decision on a request starting on a day: closes that day's quota year and the years
   * after it again, if they were closed, each with its own credited days and cap.
   */
  async reclose(
    tx: TenantTx,
    tenantId: string,
    actor: AuditActor,
    userId: string,
    typeKey: string,
    day: string,
  ): Promise<void> {
    const type = await this.types.find(tx, tenantId, typeKey);
    if (!type) return;
    const year = await this.yearOf(tx, tenantId, type, day);
    const rows = await tx
      .select()
      .from(leaveYearClosings)
      .where(
        and(
          eq(leaveYearClosings.tenantId, tenantId),
          eq(leaveYearClosings.userId, userId),
          eq(leaveYearClosings.leaveTypeKey, typeKey),
          gte(leaveYearClosings.yearFrom, year.from),
        ),
      )
      .orderBy(asc(leaveYearClosings.yearFrom));
    if (rows.length === 0) return;
    let carriedIn = Number(rows[0]!.carriedIn);
    const changed: { yearFrom: string; carriedOut: number; lapsed: number }[] = [];
    for (const row of rows) {
      const after = await this.write(
        tx,
        tenantId,
        userId,
        type,
        { from: row.yearFrom, to: row.yearTo },
        { credited: Number(row.credited), carriedIn, cap: Number(row.cap) },
      );
      if (after.carriedOut !== Number(row.carriedOut) || after.lapsed !== Number(row.lapsed)) {
        changed.push({ yearFrom: row.yearFrom, ...after });
      }
      carriedIn = after.carriedOut;
    }
    if (changed.length > 0) {
      await this.audit.record(tx, tenantId, actor, {
        action: 'leave.years_closed',
        target: { type: 'user', id: userId },
        after: { leaveType: typeKey, years: changed },
      });
    }
  }

  private async write(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    type: LeaveType,
    year: Year,
    figures: { credited: number; carriedIn: number; cap: number },
  ): Promise<{ carriedOut: number; lapsed: number }> {
    const taken = await this.approved(tx, tenantId, userId, type.key, year);
    const { carriedOut, lapsed } = closeLeaveYear({ ...figures, taken });
    const values = {
      credited: String(figures.credited),
      carriedIn: String(figures.carriedIn),
      taken: String(taken),
      carriedOut: String(carriedOut),
      lapsed: String(lapsed),
      cap: String(figures.cap),
    };
    await tx
      .insert(leaveYearClosings)
      .values({
        tenantId,
        userId,
        leaveTypeKey: type.key,
        yearFrom: year.from,
        yearTo: year.to,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          leaveYearClosings.tenantId,
          leaveYearClosings.userId,
          leaveYearClosings.leaveTypeKey,
          leaveYearClosings.yearFrom,
        ],
        set: { ...values, closedAt: new Date() },
      });
    return { carriedOut, lapsed };
  }

  private async closing(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    typeKey: string,
    yearFrom: string,
  ): Promise<Closing | undefined> {
    const [row] = await tx
      .select()
      .from(leaveYearClosings)
      .where(
        and(
          eq(leaveYearClosings.tenantId, tenantId),
          eq(leaveYearClosings.userId, userId),
          eq(leaveYearClosings.leaveTypeKey, typeKey),
          eq(leaveYearClosings.yearFrom, yearFrom),
        ),
      );
    return row;
  }

  /** Approved days of a type starting in a quota year. */
  private async approved(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    typeKey: string,
    year: Year,
  ): Promise<number> {
    const [row] = await tx
      .select({ days: sql<string | null>`sum(${leaveRequests.days})` })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.tenantId, tenantId),
          eq(leaveRequests.userId, userId),
          eq(leaveRequests.leaveTypeKey, typeKey),
          eq(leaveRequests.state, 'approved'),
          gte(leaveRequests.startDate, year.from),
          lte(leaveRequests.startDate, year.to),
        ),
      );
    return Number(row?.days ?? 0);
  }
}
