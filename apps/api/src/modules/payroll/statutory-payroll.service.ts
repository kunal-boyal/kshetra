import { Injectable } from '@nestjs/common';
import {
  AppError,
  esiCovered as coveredByEsi,
  esiPeriodStart,
  financialYearStart,
  issueAt,
  newId,
  type PayAdjustmentBody,
  type PayRunResult,
  type PayslipFigures,
  payslipFor,
  type SalaryStructure,
  type SalaryStructureBody,
  type SalaryStructureResult,
  STATUTORY_RULES_VERSION,
  type StatutoryPayslip,
  type StatutoryProfileBody,
  type StatutoryProfileResult,
  type StatutoryStateCode,
  structureWages,
  components,
  scaled,
  todayIn,
  unscaled,
} from '@thelamp/shared';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import {
  payAdjustments,
  payRuns,
  payslips,
  salaryStructures,
  statutoryProfiles,
} from '../../db/schema/payroll';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { StatutoryRates } from '../../platform/planes';
import { AttendanceService } from '../field/attendance.service';
import { notFound, outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

type StructureRow = typeof salaryStructures.$inferSelect;
type RunRow = typeof payRuns.$inferSelect;

const invalid = (path: (string | number)[], issue: string) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', [issueAt(path, issue)]);

/** The first and last day of a month. */
const monthRange = (period: string) => {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return {
    from: `${period}-01`,
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
};

/** Numbers as the database keeps them, as decimal strings to the paisa. */
const money = (value: string) => unscaled(scaled(value, 2), 2);

/** The sum of decimal strings, to the paisa. */
const total = (values: readonly string[]) =>
  unscaled(
    values.reduce((sum, value) => sum + scaled(value, 2), 0n),
    2,
  );

const structureOf = (row: StructureRow): SalaryStructure => ({
  basic: money(row.basic),
  da: money(row.da),
  hra: money(row.hra),
  conveyance: money(row.conveyance),
  special: money(row.special),
  others: (row.others as SalaryStructure['others']).map((other) => ({
    ...other,
    amount: money(other.amount),
  })),
});

const NO_PROFILE: StatutoryProfileBody = {
  workState: null,
  ptWomen: false,
  pfMember: true,
  pfFullWage: false,
  uan: null,
  esiNumber: null,
  panOnFile: false,
};

/**
 * Statutory payroll (M14, BR-56 to BR-58, decision D128): salary structures and statutory
 * profiles, a month's pay run worked out with the shared rules and the vendor's rate set in force,
 * and payslips frozen once the run is approved. Behind the `statutory_payroll` module, off until
 * an admin switches it on; every answer says whether a chartered accountant has reviewed the
 * rules and rate set. Audit entries never hold an amount.
 */
@Injectable()
export class StatutoryPayrollService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly people: People,
    private readonly scopes: Scopes,
    private readonly config: TenantConfigService,
    private readonly rates: StatutoryRates,
    private readonly audit: AuditLog,
  ) {}

  private async thisMonth(tx: TenantTx, tenantId: string): Promise<string> {
    return todayIn((await this.config.settings(tx, tenantId)).timezone).slice(0, 7);
  }

  private async person(tx: TenantTx, access: Access, userId: string) {
    const [person] = (await this.people.facts(tx, access.tenantId, [userId])).values();
    if (!person) throw notFound();
    if (!(await this.scopes.reaches(tx, access, userId))) throw outOfScope();
    return person;
  }

  // Salary structures (BR-56).

  async structures(tx: TenantTx, access: Access, userId: string): Promise<SalaryStructureResult> {
    await this.person(tx, access, userId);
    const rows = (await this.structureRows(tx, access.tenantId, [userId])).get(userId) ?? [];
    return {
      userId,
      changes: rows.map((row) => {
        const structure = structureOf(row);
        return {
          from: row.fromPeriod,
          ...structure,
          others: [...structure.others],
          wages: structureWages(structure),
          gross: total(components(structure).map((entry) => entry.amount)),
        };
      }),
    };
  }

  /** A structure from a month; a month before the latest change, or one already paid, refuses. */
  async setStructure(
    tx: TenantTx,
    access: Access,
    userId: string,
    body: SalaryStructureBody,
  ): Promise<SalaryStructureResult> {
    await this.person(tx, access, userId);
    await this.writeStructure(tx, access, userId, body, ['from']);
    return this.structures(tx, access, userId);
  }

  /** Writes one structure change; shared with the import, which names the field its own way. */
  async writeStructure(
    tx: TenantTx,
    access: Access,
    userId: string,
    body: SalaryStructureBody,
    path: (string | number)[],
  ): Promise<void> {
    const period = body.from ?? (await this.thisMonth(tx, access.tenantId));
    const latest = ((await this.structureRows(tx, access.tenantId, [userId])).get(userId) ?? []).at(
      -1,
    );
    if (latest && period < latest.fromPeriod) {
      throw invalid(
        path,
        `Start in ${latest.fromPeriod} or later, when the structure last changed`,
      );
    }
    const [frozen] = await tx
      .select({ period: payRuns.period })
      .from(payRuns)
      .where(
        and(
          eq(payRuns.tenantId, access.tenantId),
          eq(payRuns.status, 'approved'),
          gte(payRuns.period, period),
        ),
      )
      .limit(1);
    if (frozen) throw invalid(path, `${frozen.period} is already paid; start after it`);
    const values = {
      basic: body.basic,
      da: body.da,
      hra: body.hra,
      conveyance: body.conveyance,
      special: body.special,
      others: body.others,
      updatedBy: access.userId,
      updatedAt: new Date(),
    };
    await tx
      .insert(salaryStructures)
      .values({ tenantId: access.tenantId, userId, fromPeriod: period, ...values })
      .onConflictDoUpdate({
        target: [salaryStructures.tenantId, salaryStructures.userId, salaryStructures.fromPeriod],
        set: values,
      });
    // That it changed, and from when, is enough; the figures stay out of the audit log.
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'salary.structure_changed',
      target: { type: 'user', id: userId },
      after: { from: period },
    });
  }

  private async structureRows(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, StructureRow[]>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select()
      .from(salaryStructures)
      .where(
        and(eq(salaryStructures.tenantId, tenantId), inArray(salaryStructures.userId, [...ids])),
      )
      .orderBy(asc(salaryStructures.fromPeriod));
    const found = new Map<string, StructureRow[]>();
    for (const row of rows) found.set(row.userId, [...(found.get(row.userId) ?? []), row]);
    return found;
  }

  // Statutory profiles.

  async profile(tx: TenantTx, access: Access, userId: string): Promise<StatutoryProfileResult> {
    await this.person(tx, access, userId);
    return {
      userId,
      ...((await this.profiles(tx, access.tenantId, [userId])).get(userId) ?? NO_PROFILE),
    };
  }

  async setProfile(
    tx: TenantTx,
    access: Access,
    userId: string,
    body: StatutoryProfileBody,
  ): Promise<StatutoryProfileResult> {
    await this.person(tx, access, userId);
    const values = { ...body, updatedBy: access.userId, updatedAt: new Date() };
    await tx
      .insert(statutoryProfiles)
      .values({ tenantId: access.tenantId, userId, ...values })
      .onConflictDoUpdate({
        target: [statutoryProfiles.tenantId, statutoryProfiles.userId],
        set: values,
      });
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'statutory.profile_changed',
      target: { type: 'user', id: userId },
      after: { workState: body.workState, pfMember: body.pfMember, panOnFile: body.panOnFile },
    });
    return { userId, ...body };
  }

  private async profiles(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, StatutoryProfileBody>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select()
      .from(statutoryProfiles)
      .where(
        and(eq(statutoryProfiles.tenantId, tenantId), inArray(statutoryProfiles.userId, [...ids])),
      );
    return new Map(
      rows.map((row) => [
        row.userId,
        {
          workState: row.workState as StatutoryStateCode | null,
          ptWomen: row.ptWomen,
          pfMember: row.pfMember,
          pfFullWage: row.pfFullWage,
          uan: row.uan,
          esiNumber: row.esiNumber,
          panOnFile: row.panOnFile,
        },
      ]),
    );
  }

  // Adjustments.

  async addAdjustment(tx: TenantTx, access: Access, body: PayAdjustmentBody): Promise<void> {
    await this.person(tx, access, body.userId);
    const [run] = await this.runRow(tx, access.tenantId, body.period);
    if (run?.status === 'approved') {
      throw invalid(['period'], `${body.period} is already paid; add it to a later month`);
    }
    await tx.insert(payAdjustments).values({
      tenantId: access.tenantId,
      id: body.id,
      userId: body.userId,
      period: body.period,
      kind: body.kind,
      key: body.key,
      amount: body.amount,
      note: body.note,
      createdBy: access.userId,
    });
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'pay_adjustment.added',
      target: { type: 'user', id: body.userId },
      after: { period: body.period, kind: body.kind, key: body.key },
    });
  }

  // Pay runs (D128).

  private async runRow(tx: TenantTx, tenantId: string, period: string): Promise<RunRow[]> {
    return tx
      .select()
      .from(payRuns)
      .where(and(eq(payRuns.tenantId, tenantId), eq(payRuns.period, period)));
  }

  /** `POST /v1/pay-runs`: the month's draft, worked out now; an existing run is answered as it is. */
  async createRun(tx: TenantTx, access: Access, period: string): Promise<PayRunResult> {
    if (period > (await this.thisMonth(tx, access.tenantId))) {
      throw invalid(['period'], 'Choose this month or one before it');
    }
    const [existing] = await this.runRow(tx, access.tenantId, period);
    if (existing) return this.run(tx, access, period);
    const { set } = await this.rates.forMonth(period);
    if (!set) throw new AppError('CONFLICT', 'No statutory rates are in force for this month.');
    const id = newId();
    await tx.insert(payRuns).values({
      tenantId: access.tenantId,
      id,
      period,
      rateSetId: set.id,
      rulesVersion: STATUTORY_RULES_VERSION,
      createdBy: access.userId,
    });
    await this.compute(tx, access, id, period, set.id);
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'pay_run.created',
      target: { type: 'pay_run', id },
      after: { period, rateSetId: set.id },
    });
    return this.run(tx, access, period);
  }

  /** Works a draft out again from today's structures, profiles, days and adjustments. */
  async recompute(tx: TenantTx, access: Access, period: string): Promise<PayRunResult> {
    const [run] = await this.runRow(tx, access.tenantId, period);
    if (!run) throw notFound();
    if (run.status === 'approved') {
      throw new AppError('CONFLICT', 'An approved pay run never changes; adjust a later month.');
    }
    const { set } = await this.rates.forMonth(period);
    if (!set) throw new AppError('CONFLICT', 'No statutory rates are in force for this month.');
    await tx
      .update(payRuns)
      .set({ rateSetId: set.id, rulesVersion: STATUTORY_RULES_VERSION, version: run.version + 1 })
      .where(and(eq(payRuns.tenantId, access.tenantId), eq(payRuns.id, run.id)));
    await this.compute(tx, access, run.id, period, set.id);
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'pay_run.recomputed',
      target: { type: 'pay_run', id: run.id },
      after: { period, rateSetId: set.id },
    });
    return this.run(tx, access, period);
  }

  /** Approves a draft at the version the approver saw, freezing its payslips. */
  async approve(
    tx: TenantTx,
    access: Access,
    period: string,
    version: number,
  ): Promise<PayRunResult> {
    const [run] = await tx
      .select()
      .from(payRuns)
      .where(and(eq(payRuns.tenantId, access.tenantId), eq(payRuns.period, period)))
      .for('update');
    if (!run) throw notFound();
    if (run.status === 'approved') throw new AppError('CONFLICT', 'This pay run is approved.');
    if (run.version !== version) {
      throw new AppError('CONFLICT', 'This pay run changed meanwhile. Read it again.');
    }
    await tx
      .update(payRuns)
      .set({
        status: 'approved',
        version: run.version + 1,
        approvedBy: access.userId,
        approvedAt: new Date(),
      })
      .where(and(eq(payRuns.tenantId, access.tenantId), eq(payRuns.id, run.id)));
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'pay_run.approved',
      target: { type: 'pay_run', id: run.id },
      after: { period },
    });
    return this.run(tx, access, period);
  }

  /**
   * Each person's payslip for the run (BR-56 to BR-58): everyone in the tenant with a structure in
   * force for the month and employed in it, with their days, ESI coverage for the contribution
   * period, the financial year so far from approved runs, and the month's adjustments.
   */
  private async compute(
    tx: TenantTx,
    access: Access,
    runId: string,
    period: string,
    rateSetId: string,
  ): Promise<void> {
    const tenantId = access.tenantId;
    const set = await this.rates.byId(rateSetId);
    if (!set) throw new AppError('CONFLICT', 'The rate set is no longer kept.');
    const range = monthRange(period);
    const everyone = await this.people.among(
      tx,
      tenantId,
      sql`select id from cell.users where tenant_id = ${tenantId}`,
      range.from,
    );
    const structures = await this.structureRows(
      tx,
      tenantId,
      everyone.map((person) => person.id),
    );
    const paid = everyone.filter((person) =>
      (structures.get(person.id) ?? []).some((row) => row.fromPeriod <= period),
    );
    const ids = paid.map((person) => person.id);
    const days = await this.attendance.days(tx, tenantId, ids, range.from, range.to);
    const profiles = await this.profiles(tx, tenantId, ids);
    const adjustments = ids.length
      ? await tx
          .select()
          .from(payAdjustments)
          .where(
            and(
              eq(payAdjustments.tenantId, tenantId),
              eq(payAdjustments.period, period),
              inArray(payAdjustments.userId, ids),
            ),
          )
      : [];
    const yearToDate = await this.yearToDate(tx, tenantId, ids, period);
    const esiStart = esiPeriodStart(period);
    for (const person of paid) {
      const changes = structures.get(person.id)!;
      const inForce = changes.filter((row) => row.fromPeriod <= period).at(-1)!;
      // ESI coverage is fixed for the contribution period by the wages at its start (BR-57).
      const atStart =
        changes.filter((row) => row.fromPeriod <= esiStart).at(-1) ??
        changes.find((row) => row.fromPeriod <= period)!;
      const covered = coveredByEsi(structureWages(structureOf(atStart)), set.rates.esi);
      const personDays = days.get(person.id) ?? [];
      const paidHalves = personDays.reduce((total, day) => total + Math.round(day.value * 2), 0);
      const scheduled = personDays.filter((day) => day.working).length;
      const profile = profiles.get(person.id) ?? NO_PROFILE;
      const structure = structureOf(inForce);
      const figures: PayslipFigures = payslipFor({
        period,
        structure,
        profile: { ...profile, workState: profile.workState as StatutoryStateCode | null },
        paidHalves,
        scheduled,
        esiCovered: covered,
        adjustments: adjustments
          .filter((entry) => entry.userId === person.id)
          .map((entry) => ({
            key: entry.key,
            kind: entry.kind as 'earning' | 'deduction',
            amount: money(entry.amount),
          })),
        yearToDate: yearToDate.get(person.id) ?? { paid: '0', tds: '0' },
        rates: set.rates,
      });
      const tds = figures.deductions.find((line) => line.key === 'tds')?.amount ?? '0.00';
      const values = {
        period,
        included: true,
        structure,
        profile,
        paidHalves,
        scheduled,
        esiCovered: covered,
        figures,
        gross: figures.gross,
        tds,
        net: figures.net,
      };
      await tx
        .insert(payslips)
        .values({ tenantId, payRunId: runId, userId: person.id, ...values })
        .onConflictDoUpdate({
          target: [payslips.tenantId, payslips.payRunId, payslips.userId],
          set: values,
        });
    }
    // Someone no longer paid this month leaves the draft, kept and marked out.
    await tx
      .update(payslips)
      .set({ included: false })
      .where(
        and(
          eq(payslips.tenantId, tenantId),
          eq(payslips.payRunId, runId),
          ids.length ? sql`${payslips.userId} not in ${ids}` : sql`true`,
        ),
      );
  }

  /** What approved runs earlier in the financial year paid and deducted as TDS, by person. */
  private async yearToDate(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
    period: string,
  ): Promise<Map<string, { paid: string; tds: string }>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({
        userId: payslips.userId,
        paid: sql<string>`sum(${payslips.gross})::text`,
        tds: sql<string>`sum(${payslips.tds})::text`,
      })
      .from(payslips)
      .innerJoin(
        payRuns,
        and(eq(payRuns.tenantId, payslips.tenantId), eq(payRuns.id, payslips.payRunId)),
      )
      .where(
        and(
          eq(payslips.tenantId, tenantId),
          inArray(payslips.userId, [...ids]),
          eq(payslips.included, true),
          eq(payRuns.status, 'approved'),
          gte(payslips.period, financialYearStart(period)),
          lt(payslips.period, period),
        ),
      )
      .groupBy(payslips.userId);
    return new Map(rows.map((row) => [row.userId, { paid: money(row.paid), tds: money(row.tds) }]));
  }

  /** `GET /v1/pay-runs/{period}`: the run and each person's totals. */
  async run(tx: TenantTx, access: Access, period: string): Promise<PayRunResult> {
    const [run] = await this.runRow(tx, access.tenantId, period);
    if (!run) throw notFound();
    const rows = await tx
      .select()
      .from(payslips)
      .where(
        and(
          eq(payslips.tenantId, access.tenantId),
          eq(payslips.payRunId, run.id),
          eq(payslips.included, true),
        ),
      );
    const people = await this.people.facts(tx, access.tenantId, [
      ...rows.map((row) => row.userId),
      ...(run.approvedBy ? [run.approvedBy] : []),
    ]);
    const set = await this.rates.byId(run.rateSetId);
    const summed = (pick: (figures: PayslipFigures) => string[]) =>
      total(rows.flatMap((row) => pick(row.figures as PayslipFigures)));
    const personOf = (id: string) => {
      const person = people.get(id);
      return { id, code: person?.code ?? '', name: person?.name ?? '' };
    };
    return {
      id: run.id,
      period: run.period,
      status: run.status as 'draft' | 'approved',
      version: run.version,
      rateSet: { id: run.rateSetId, from: set?.from ?? '' },
      reviewed: await this.rates.reviewed(run.rateSetId),
      approvedAt: run.approvedAt?.toISOString() ?? null,
      approvedBy: run.approvedBy ? personOf(run.approvedBy) : null,
      totals: {
        gross: summed((figures) => [figures.gross]),
        deductions: summed((figures) => [figures.totalDeductions]),
        net: summed((figures) => [figures.net]),
        employer: summed((figures) => figures.employer.map((line) => line.amount)),
      },
      payslips: rows
        .map((row) => {
          const figures = row.figures as PayslipFigures;
          return {
            user: personOf(row.userId),
            gross: figures.gross,
            totalDeductions: figures.totalDeductions,
            net: figures.net,
            flags: figures.flags,
          };
        })
        .sort((a, b) => a.user.code.localeCompare(b.user.code)),
    };
  }

  /**
   * `GET /v1/statutory-payslips/{userId}/{period}`: one payslip. A person sees their own once the
   * run is approved, with `payslip.view`; anyone else's needs `payroll.run`.
   */
  async payslip(
    tx: TenantTx,
    access: Access,
    userId: string,
    period: string,
  ): Promise<StatutoryPayslip> {
    const own = !access.support && !access.apiClient && userId === access.userId;
    const runner = access.permissions.has('payroll.run');
    if (!own && !runner)
      throw new AppError('FORBIDDEN', 'Only payroll may see another person’s payslip.');
    if (own && !runner && !access.permissions.has('payslip.view')) {
      throw new AppError('FORBIDDEN', 'Your role doesn’t show payslips.');
    }
    if (!own) await this.person(tx, access, userId);
    const [run] = await this.runRow(tx, access.tenantId, period);
    if (!run || (!runner && run.status !== 'approved')) throw notFound();
    const [row] = await tx
      .select()
      .from(payslips)
      .where(
        and(
          eq(payslips.tenantId, access.tenantId),
          eq(payslips.payRunId, run.id),
          eq(payslips.userId, userId),
          eq(payslips.included, true),
        ),
      );
    if (!row) throw notFound();
    const [person] = (await this.people.facts(tx, access.tenantId, [userId])).values();
    const figures = row.figures as PayslipFigures;
    return {
      user: { id: userId, code: person?.code ?? '', name: person?.name ?? '' },
      period,
      status: run.status as 'draft' | 'approved',
      profile: row.profile as StatutoryProfileBody,
      structure: {
        ...(row.structure as SalaryStructure),
        others: [...(row.structure as SalaryStructure).others],
      },
      scheduled: row.scheduled,
      paid: row.paidHalves / 2,
      esiCovered: row.esiCovered,
      wages: figures.wages,
      earnings: figures.earnings,
      deductions: figures.deductions,
      employer: figures.employer,
      gross: figures.gross,
      totalDeductions: figures.totalDeductions,
      net: figures.net,
      flags: figures.flags,
      rateSetId: run.rateSetId,
      reviewed: await this.rates.reviewed(run.rateSetId),
    };
  }

  /** The pay register's rows: each included payslip of the month's run, for the people given. */
  async registerRows(tx: TenantTx, tenantId: string, peopleIds: SQLLike, period: string) {
    const [run] = await this.runRow(tx, tenantId, period);
    if (!run) return { run: null, rows: [] };
    const rows = await tx
      .select({ userId: payslips.userId, figures: payslips.figures })
      .from(payslips)
      .where(
        and(
          eq(payslips.tenantId, tenantId),
          eq(payslips.payRunId, run.id),
          eq(payslips.included, true),
          sql`${payslips.userId} in (${peopleIds})`,
        ),
      );
    return {
      run,
      rows: rows.map((row) => ({ userId: row.userId, figures: row.figures as PayslipFigures })),
    };
  }

  /**
   * Erasure (decision D95): a person's structures and statutory profile go with them. Payslips
   * of approved runs stay, as payroll records the employer must keep.
   */
  async erasePerson(tx: TenantTx, tenantId: string, userId: string): Promise<void> {
    await tx
      .delete(salaryStructures)
      .where(and(eq(salaryStructures.tenantId, tenantId), eq(salaryStructures.userId, userId)));
    await tx
      .delete(statutoryProfiles)
      .where(and(eq(statutoryProfiles.tenantId, tenantId), eq(statutoryProfiles.userId, userId)));
  }
}

type SQLLike = ReturnType<typeof sql>;
