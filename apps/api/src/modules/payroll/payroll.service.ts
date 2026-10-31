import { Injectable } from '@nestjs/common';
import {
  AppError,
  dayCounts,
  type GrossChange,
  grossOn,
  issueAt,
  type PayrollGrossResult,
  type PayrollListResult,
  type PayrollMonth,
  type PayslipResult,
  provisionalPay,
  todayIn,
} from '@thelamp/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { payrollGross } from '../../db/schema/payroll';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { AttendanceService } from '../field/attendance.service';
import { notFound, outOfScope } from '../iam/actor';
import { People, type PersonFacts } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

type DaysByPerson = Awaited<ReturnType<AttendanceService['days']>>;

/** The first and last day of a month. */
const monthRange = (period: string) => {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return {
    from: `${period}-01`,
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
};

/**
 * Payroll inputs (M14, BR-26, decisions D14 and D117): each person's monthly gross from a month,
 * and the provisional pay their attendance earns, worked out on read from the month's days. An
 * attendance-based estimate for a payroll provider; nothing statutory is computed.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly people: People,
    private readonly scopes: Scopes,
    private readonly config: TenantConfigService,
    private readonly audit: AuditLog,
  ) {}

  /** `PUT /v1/payroll-gross/{userId}`: a person's gross from a month, this month when left out. */
  async setGross(
    tx: TenantTx,
    access: Access,
    userId: string,
    input: { monthlyGross: string; from?: string | undefined },
  ): Promise<PayrollGrossResult> {
    const [person] = (await this.people.facts(tx, access.tenantId, [userId])).values();
    if (!person) throw notFound();
    if (!(await this.scopes.reaches(tx, access, userId))) throw outOfScope();
    await this.write(tx, access, userId, input.monthlyGross, input.from, ['from']);
    return this.changesOf(tx, access.tenantId, userId);
  }

  /**
   * Writes one change, refusing a month before the person's latest change: months already priced
   * keep their gross. Shared with the import, which names the field its own way.
   */
  async write(
    tx: TenantTx,
    access: Access,
    userId: string,
    monthlyGross: string,
    from: string | undefined,
    path: (string | number)[],
  ): Promise<void> {
    const { timezone } = await this.config.settings(tx, access.tenantId);
    const period = from ?? todayIn(timezone).slice(0, 7);
    const issue = await this.fromIssue(tx, access.tenantId, userId, period);
    if (issue)
      throw new AppError('VALIDATION', 'Check the highlighted fields.', [issueAt(path, issue)]);
    await tx
      .insert(payrollGross)
      .values({
        tenantId: access.tenantId,
        userId,
        fromPeriod: period,
        monthlyGross,
        updatedBy: access.userId,
      })
      .onConflictDoUpdate({
        target: [payrollGross.tenantId, payrollGross.userId, payrollGross.fromPeriod],
        set: { monthlyGross, updatedBy: access.userId, updatedAt: new Date() },
      });
    // The figure stays out of the audit log; that it changed, and from when, is enough.
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'payroll.gross_changed',
      target: { type: 'user', id: userId },
      after: { from: period },
    });
  }

  /** Why a change can't start in a month: before the person's latest change. */
  async fromIssue(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    period: string,
  ): Promise<string | null> {
    const changes = (await this.changes(tx, tenantId, [userId])).get(userId) ?? [];
    const latest = changes.at(-1);
    return latest && period < latest.from
      ? `Start in ${latest.from} or later, when the gross last changed`
      : null;
  }

  /** `GET /v1/payroll-gross/{userId}`: a person in scope's changes. */
  async gross(tx: TenantTx, access: Access, userId: string): Promise<PayrollGrossResult> {
    const [person] = (await this.people.facts(tx, access.tenantId, [userId])).values();
    if (!person) throw notFound();
    if (!(await this.scopes.reaches(tx, access, userId))) throw outOfScope();
    return this.changesOf(tx, access.tenantId, userId);
  }

  async changesOf(tx: TenantTx, tenantId: string, userId: string): Promise<PayrollGrossResult> {
    return { userId, changes: (await this.changes(tx, tenantId, [userId])).get(userId) ?? [] };
  }

  /** `GET /v1/payroll`: the month for everyone the caller reaches, by code, a page at a time. */
  async list(
    tx: TenantTx,
    access: Access,
    period: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<PayrollListResult> {
    this.notAhead(period, (await this.config.settings(tx, access.tenantId)).timezone);
    const offset = Number(cursor ?? 0) || 0;
    const everyone = await this.people.among(
      tx,
      access.tenantId,
      await this.scopes.userIds(tx, access),
      monthRange(period).from,
    );
    const page = everyone.slice(offset, offset + limit);
    return {
      items: await this.months(tx, access.tenantId, page, period),
      nextCursor: offset + limit < everyone.length ? String(offset + limit) : null,
    };
  }

  /**
   * `GET /v1/payslips/{userId}/{period}`: one person's month with its days by status. Anyone sees
   * their own with `payslip.view`; another's needs `payroll.manage` and the person in scope.
   */
  async payslip(
    tx: TenantTx,
    access: Access,
    userId: string,
    period: string,
  ): Promise<PayslipResult> {
    this.notAhead(period, (await this.config.settings(tx, access.tenantId)).timezone);
    const own = !access.support && !access.apiClient && userId === access.userId;
    if (!own) {
      if (!access.permissions.has('payroll.manage')) {
        throw new AppError('FORBIDDEN', 'Only payroll may see another person’s estimate.');
      }
    } else if (
      !access.permissions.has('payslip.view') &&
      !access.permissions.has('payroll.manage')
    ) {
      throw new AppError('FORBIDDEN', 'Your role doesn’t show pay estimates.');
    }
    const [person] = (await this.people.facts(tx, access.tenantId, [userId])).values();
    if (!person) throw notFound();
    if (!own && !(await this.scopes.reaches(tx, access, userId))) throw outOfScope();
    const range = monthRange(period);
    const days =
      (await this.attendance.days(tx, access.tenantId, [userId], range.from, range.to)).get(
        userId,
      ) ?? [];
    const [month] = await this.months(
      tx,
      access.tenantId,
      [person],
      period,
      new Map([[userId, days]]),
    );
    return { ...month!, days: dayCounts(days) };
  }

  /**
   * Each person's month (BR-26, D117): the gross in force then and what the month's days earn.
   * Shared with the payroll summary report; `known` passes days already read.
   */
  async months(
    tx: TenantTx,
    tenantId: string,
    people: readonly PersonFacts[],
    period: string,
    known?: DaysByPerson,
  ): Promise<PayrollMonth[]> {
    if (people.length === 0) return [];
    const ids = people.map((person) => person.id);
    const range = monthRange(period);
    const days = known ?? (await this.attendance.days(tx, tenantId, ids, range.from, range.to));
    const changes = await this.changes(tx, tenantId, ids);
    // The current month is still running: what it shows is earned so far.
    const toDate =
      period === todayIn((await this.config.settings(tx, tenantId)).timezone).slice(0, 7);
    return people.map((person) => {
      const gross = grossOn(changes.get(person.id) ?? [], period);
      const pay = provisionalPay(gross ?? '0', days.get(person.id) ?? []);
      return {
        user: {
          id: person.id,
          code: person.code,
          name: person.name,
          designation: person.designation,
        },
        period,
        monthlyGross: gross,
        scheduled: pay.scheduled,
        paid: pay.paid,
        amount: gross === null ? null : pay.amount,
        toDate,
      };
    });
  }

  /** The month's days by person, for the summary report's counts. */
  async days(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
    period: string,
  ): Promise<DaysByPerson> {
    const range = monthRange(period);
    return this.attendance.days(tx, tenantId, ids, range.from, range.to);
  }

  /** Erasure (decision D95): a person's gross goes with them. */
  async erasePerson(tx: TenantTx, tenantId: string, userId: string): Promise<void> {
    await tx
      .delete(payrollGross)
      .where(and(eq(payrollGross.tenantId, tenantId), eq(payrollGross.userId, userId)));
  }

  private async changes(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, GrossChange[]>> {
    const rows =
      ids.length === 0
        ? []
        : await tx
            .select({
              userId: payrollGross.userId,
              from: payrollGross.fromPeriod,
              monthlyGross: payrollGross.monthlyGross,
            })
            .from(payrollGross)
            .where(and(eq(payrollGross.tenantId, tenantId), inArray(payrollGross.userId, [...ids])))
            .orderBy(asc(payrollGross.fromPeriod));
    const found = new Map<string, GrossChange[]>();
    for (const row of rows) {
      const list = found.get(row.userId) ?? [];
      list.push({ from: row.from, monthlyGross: row.monthlyGross });
      found.set(row.userId, list);
    }
    return found;
  }

  /** A month still to come earns nothing yet. */
  private notAhead(period: string, timezone: string): void {
    if (period > todayIn(timezone).slice(0, 7)) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', [
        issueAt(['period'], 'Choose this month or one before it'),
      ]);
    }
  }
}
