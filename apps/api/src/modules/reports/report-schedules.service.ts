import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AppError,
  CreateReportScheduleBody,
  type ExportReport,
  type ExportStatus,
  type LocalMoment,
  newId,
  nextSendDate,
  type ReportScheduleDetail,
  type ReportScheduleListResult,
  type ReportScheduleResult,
  type ReportScheduleRun,
  SCHEDULES_PER_TENANT_MOST,
  scheduledPeriod,
  type ScheduleTiming,
  sendDue,
  timeIn,
  todayIn,
  type UpdateReportScheduleBody,
} from '@thelamp/shared';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Config } from '../../config';
import {
  exportJobs,
  reportScheduleRecipients,
  reportScheduleRuns,
  reportSchedules,
} from '../../db/schema/reports';
import { AuditLog, SYSTEM_ACTOR, userActor } from '../../platform/audit';
import { type Access, AccessResolver } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { CONFIG } from '../../platform/tokens';
import { invalid, notFound } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { ReportsService } from './reports.service';

type Row = typeof reportSchedules.$inferSelect;

/** How often each tenant's schedules are asked whether a send is due. */
const DUE_EVERY_MS = 15 * 60_000;

/** The most schedules one look sends, so a backlog spreads over the next looks. */
const DUE_BATCH = 50;

/** The sends a schedule's page shows. */
const RUNS_SHOWN = 10;

const timingOf = (row: Pick<Row, 'frequency' | 'weekday' | 'at'>): ScheduleTiming => ({
  frequency: row.frequency,
  weekday: row.weekday,
  at: row.at,
});

const momentIn = (timezone: string, at: Date): LocalMoment => ({
  date: todayIn(timezone, at),
  time: timeIn(timezone, at),
});

/**
 * Scheduled reports (M18, BR-52, decision D122). An owner names a report, its filters and who gets
 * it, weekly or monthly; each send makes an ordinary export for each recipient, created as theirs,
 * so it is read as they may see it and only they download it, and they hear by email with a link.
 */
@Injectable()
export class ReportSchedulesService implements OnModuleInit {
  private readonly logger = new Logger(ReportSchedulesService.name);

  constructor(
    private readonly database: Database,
    private readonly reports: ReportsService,
    private readonly people: People,
    private readonly scopes: Scopes,
    private readonly config: TenantConfigService,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    private readonly audit: AuditLog,
    private readonly access: AccessResolver,
    @Inject(CONFIG) private readonly settings: Config,
  ) {}

  onModuleInit(): void {
    this.queues.handle('exports', 'report_schedules.due', (data) =>
      this.due(String(data.tenantId), new Date(String(data.at))),
    );
    this.schedules.everyForTenants({
      name: 'report_schedules.due',
      everyMs: DUE_EVERY_MS,
      queue: 'exports',
      kind: 'report_schedules.due',
    });
  }

  /**
   * Every recipient must be someone the owner sees, active, and allowed to export: each will get
   * the report as they may see it, so nobody receives what the product would not show them.
   */
  private async checkRecipients(tx: TenantTx, access: Access, ids: readonly string[]) {
    const exporters = await this.people.holdingAmong(tx, access.tenantId, 'export.create', ids);
    for (const [index, id] of ids.entries()) {
      if (!(await this.scopes.reaches(tx, access, id))) {
        throw invalid(`recipients[${index}]`, 'Choose someone you can see');
      }
      if (!exporters.has(id)) {
        throw invalid(`recipients[${index}]`, 'This person may not receive reports');
      }
    }
  }

  /** The owner may see the report with these filters this month, or the schedule is refused. */
  private async checkReport(
    tx: TenantTx,
    access: Access,
    report: ExportReport,
    filters: Row['filters'],
  ) {
    const { timezone } = await this.config.settings(tx, access.tenantId);
    await this.reports.check(tx, access, report, {
      ...filters,
      period: todayIn(timezone).slice(0, 7),
    });
  }

  private async owned(tx: TenantTx, access: Access, id: string): Promise<Row> {
    const [row] = await tx
      .select()
      .from(reportSchedules)
      .where(
        and(
          eq(reportSchedules.tenantId, access.tenantId),
          eq(reportSchedules.id, id),
          eq(reportSchedules.ownerId, access.userId),
          isNull(reportSchedules.endedAt),
        ),
      )
      .for('update');
    if (!row) throw notFound();
    return row;
  }

  /** The people who still receive these schedules, by schedule. */
  private async recipientsOf(tx: TenantTx, tenantId: string, ids: readonly string[]) {
    const byId = new Map<string, string[]>();
    if (ids.length === 0) return byId;
    const rows = await tx
      .select({
        scheduleId: reportScheduleRecipients.scheduleId,
        userId: reportScheduleRecipients.userId,
      })
      .from(reportScheduleRecipients)
      .where(
        and(
          eq(reportScheduleRecipients.tenantId, tenantId),
          inArray(reportScheduleRecipients.scheduleId, [...ids]),
          isNull(reportScheduleRecipients.leftAt),
        ),
      )
      .orderBy(reportScheduleRecipients.addedAt);
    for (const row of rows) {
      byId.set(row.scheduleId, [...(byId.get(row.scheduleId) ?? []), row.userId]);
    }
    return byId;
  }

  /** Schedules as the caller reads them: a recipient sees only themselves among the recipients. */
  private async results(
    tx: TenantTx,
    access: Access,
    rows: readonly Row[],
  ): Promise<ReportScheduleResult[]> {
    const { timezone } = await this.config.settings(tx, access.tenantId);
    const now = momentIn(timezone, new Date());
    const recipients = await this.recipientsOf(
      tx,
      access.tenantId,
      rows.map((row) => row.id),
    );
    const people = await this.people.facts(tx, access.tenantId, [
      ...rows.map((row) => row.ownerId),
      ...[...recipients.values()].flat(),
    ]);
    const person = (id: string) => {
      const found = people.get(id);
      return { id, code: found?.code ?? '', name: found?.name ?? '' };
    };
    return rows.map((row) => ({
      id: row.id,
      owner: person(row.ownerId),
      report: row.report as ExportReport,
      filters: row.filters,
      format: row.format as ReportScheduleResult['format'],
      locale: row.locale as ReportScheduleResult['locale'],
      frequency: row.frequency,
      weekday: row.weekday,
      at: row.at,
      status: row.status,
      pausedReason: row.pausedReason,
      recipients: (recipients.get(row.id) ?? [])
        .filter((id) => row.ownerId === access.userId || id === access.userId)
        .map(person),
      nextSend:
        row.status === 'active' && row.endedAt === null ? nextSendDate(timingOf(row), now) : null,
      createdAt: row.createdAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
    }));
  }

  /** Records a schedule, after checking its report, its filters and who it sends to. */
  async create(
    tx: TenantTx,
    access: Access,
    body: CreateReportScheduleBody,
  ): Promise<ReportScheduleResult> {
    // A schedule belongs to a person, who answers for what it sends.
    if (access.support || access.apiClient) {
      throw new AppError('FORBIDDEN', 'Only people of the organisation schedule reports.');
    }
    const [running] = await tx
      .select({ total: count() })
      .from(reportSchedules)
      .where(
        and(
          eq(reportSchedules.tenantId, access.tenantId),
          eq(reportSchedules.status, 'active'),
          isNull(reportSchedules.endedAt),
        ),
      );
    if ((running?.total ?? 0) >= SCHEDULES_PER_TENANT_MOST) {
      throw new AppError(
        'VALIDATION',
        `Your organisation runs ${SCHEDULES_PER_TENANT_MOST} schedules already. End one first.`,
      );
    }
    await this.checkReport(tx, access, body.report, body.filters);
    await this.checkRecipients(tx, access, body.recipients);
    const now = new Date();
    const [row] = await tx
      .insert(reportSchedules)
      .values({
        id: body.id,
        tenantId: access.tenantId,
        ownerId: access.userId,
        report: body.report,
        filters: body.filters,
        format: body.format,
        locale: body.locale,
        frequency: body.frequency,
        weekday: body.weekday,
        at: body.at,
        activeFrom: now,
        createdBy: access.userId,
        updatedBy: access.userId,
      })
      .returning();
    await tx.insert(reportScheduleRecipients).values(
      body.recipients.map((userId) => ({
        tenantId: access.tenantId,
        scheduleId: body.id,
        userId,
      })),
    );
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'report_schedule.created',
      target: { type: 'report_schedule', id: body.id },
      after: {
        report: body.report,
        filters: body.filters,
        format: body.format,
        locale: body.locale,
        frequency: body.frequency,
        weekday: body.weekday,
        at: body.at,
        recipients: body.recipients,
      },
    });
    return (await this.results(tx, access, [row!]))[0]!;
  }

  /** Changes a schedule, or pauses or resumes it; only its owner may. */
  async update(
    tx: TenantTx,
    access: Access,
    id: string,
    body: UpdateReportScheduleBody,
  ): Promise<ReportScheduleResult> {
    const row = await this.owned(tx, access, id);
    const before = await this.recipientsOf(tx, access.tenantId, [id]);
    const recipientsBefore = before.get(id) ?? [];
    // The whole schedule, changed, must still hold together (BR-52).
    const next = CreateReportScheduleBody.safeParse({
      id,
      report: row.report,
      filters: body.filters ?? row.filters,
      format: body.format ?? row.format,
      locale: body.locale ?? row.locale,
      frequency: body.frequency ?? row.frequency,
      weekday: body.weekday !== undefined ? body.weekday : row.weekday,
      at: body.at ?? row.at,
      recipients: body.recipients ?? recipientsBefore,
    });
    if (!next.success) {
      const issue = next.error.issues[0]!;
      throw invalid(issue.path.join('.'), issue.message);
    }
    const changed = next.data;
    if (body.filters) await this.checkReport(tx, access, row.report as ExportReport, body.filters);
    const added = body.recipients?.filter((userId) => !recipientsBefore.includes(userId)) ?? [];
    if (added.length > 0) await this.checkRecipients(tx, access, added);
    const now = new Date();
    const resuming = body.status === 'active' && row.status === 'paused';
    const pausing = body.status === 'paused' && row.status === 'active';
    const retimed =
      changed.frequency !== row.frequency ||
      changed.weekday !== row.weekday ||
      changed.at !== row.at;
    const [updated] = await tx
      .update(reportSchedules)
      .set({
        filters: changed.filters,
        format: changed.format,
        locale: changed.locale,
        frequency: changed.frequency,
        weekday: changed.weekday,
        at: changed.at,
        ...(pausing ? { status: 'paused' as const, pausedReason: 'by_owner' as const } : {}),
        ...(resuming ? { status: 'active' as const, pausedReason: null } : {}),
        // A send moment already past when it resumed or moved never goes out late.
        ...(resuming || retimed ? { activeFrom: now } : {}),
        updatedAt: now,
        updatedBy: access.userId,
      })
      .where(and(eq(reportSchedules.tenantId, access.tenantId), eq(reportSchedules.id, id)))
      .returning();
    if (body.recipients) {
      const removed = recipientsBefore.filter((userId) => !body.recipients!.includes(userId));
      if (removed.length > 0) {
        await tx
          .update(reportScheduleRecipients)
          .set({ leftAt: now })
          .where(
            and(
              eq(reportScheduleRecipients.tenantId, access.tenantId),
              eq(reportScheduleRecipients.scheduleId, id),
              inArray(reportScheduleRecipients.userId, removed),
            ),
          );
      }
      if (added.length > 0) {
        await tx
          .insert(reportScheduleRecipients)
          .values(added.map((userId) => ({ tenantId: access.tenantId, scheduleId: id, userId })))
          .onConflictDoUpdate({
            target: [
              reportScheduleRecipients.tenantId,
              reportScheduleRecipients.scheduleId,
              reportScheduleRecipients.userId,
            ],
            set: { leftAt: null, addedAt: now },
          });
      }
    }
    const shape = (schedule: Row, recipients: readonly string[]) => ({
      filters: schedule.filters,
      format: schedule.format,
      locale: schedule.locale,
      frequency: schedule.frequency,
      weekday: schedule.weekday,
      at: schedule.at,
      recipients,
    });
    const target = { type: 'report_schedule', id };
    const actor = userActor(access);
    const beforeShape = shape(row, recipientsBefore);
    const afterShape = shape(updated!, changed.recipients);
    if (JSON.stringify(beforeShape) !== JSON.stringify(afterShape)) {
      await this.audit.record(tx, access.tenantId, actor, {
        action: 'report_schedule.changed',
        target,
        before: beforeShape,
        after: afterShape,
      });
    }
    if (pausing)
      await this.audit.record(tx, access.tenantId, actor, {
        action: 'report_schedule.paused',
        target,
      });
    if (resuming)
      await this.audit.record(tx, access.tenantId, actor, {
        action: 'report_schedule.resumed',
        target,
      });
    return (await this.results(tx, access, [updated!]))[0]!;
  }

  /** Ends a schedule for good; its sends and exports stay. */
  async end(tx: TenantTx, access: Access, id: string): Promise<ReportScheduleResult> {
    await this.owned(tx, access, id);
    const [ended] = await tx
      .update(reportSchedules)
      .set({ endedAt: new Date(), updatedAt: new Date(), updatedBy: access.userId })
      .where(and(eq(reportSchedules.tenantId, access.tenantId), eq(reportSchedules.id, id)))
      .returning();
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'report_schedule.ended',
      target: { type: 'report_schedule', id },
    });
    return (await this.results(tx, access, [ended!]))[0]!;
  }

  /** A recipient stops receiving a schedule ("Stop sending me this"). */
  async leave(tx: TenantTx, access: Access, id: string): Promise<ReportScheduleResult> {
    const [left] = await tx
      .update(reportScheduleRecipients)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(reportScheduleRecipients.tenantId, access.tenantId),
          eq(reportScheduleRecipients.scheduleId, id),
          eq(reportScheduleRecipients.userId, access.userId),
          isNull(reportScheduleRecipients.leftAt),
        ),
      )
      .returning({ scheduleId: reportScheduleRecipients.scheduleId });
    if (!left) throw notFound();
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'report_schedule.left',
      target: { type: 'report_schedule', id },
    });
    const [row] = await tx
      .select()
      .from(reportSchedules)
      .where(and(eq(reportSchedules.tenantId, access.tenantId), eq(reportSchedules.id, id)));
    return (await this.results(tx, access, [row!]))[0]!;
  }

  /** The caller's own schedules, or those still sent to them, newest first. */
  async list(
    tx: TenantTx,
    access: Access,
    whose: 'owner' | 'me',
  ): Promise<ReportScheduleListResult> {
    const rows =
      whose === 'owner'
        ? await tx
            .select()
            .from(reportSchedules)
            .where(
              and(
                eq(reportSchedules.tenantId, access.tenantId),
                eq(reportSchedules.ownerId, access.userId),
                isNull(reportSchedules.endedAt),
              ),
            )
            .orderBy(desc(reportSchedules.createdAt))
        : (
            await tx
              .select({ schedule: reportSchedules })
              .from(reportScheduleRecipients)
              .innerJoin(
                reportSchedules,
                and(
                  eq(reportSchedules.tenantId, reportScheduleRecipients.tenantId),
                  eq(reportSchedules.id, reportScheduleRecipients.scheduleId),
                ),
              )
              .where(
                and(
                  eq(reportScheduleRecipients.tenantId, access.tenantId),
                  eq(reportScheduleRecipients.userId, access.userId),
                  isNull(reportScheduleRecipients.leftAt),
                  isNull(reportSchedules.endedAt),
                ),
              )
              .orderBy(desc(reportSchedules.createdAt))
          ).map((row) => row.schedule);
    return { items: await this.results(tx, access, rows) };
  }

  /** One of the caller's schedules with its latest sends and each recipient's export. */
  async get(tx: TenantTx, access: Access, id: string): Promise<ReportScheduleDetail> {
    const [row] = await tx
      .select()
      .from(reportSchedules)
      .where(
        and(
          eq(reportSchedules.tenantId, access.tenantId),
          eq(reportSchedules.id, id),
          eq(reportSchedules.ownerId, access.userId),
        ),
      );
    if (!row) throw notFound();
    const runs = await tx
      .select()
      .from(reportScheduleRuns)
      .where(
        and(
          eq(reportScheduleRuns.tenantId, access.tenantId),
          eq(reportScheduleRuns.scheduleId, id),
        ),
      )
      .orderBy(desc(reportScheduleRuns.sendDate))
      .limit(RUNS_SHOWN);
    const jobs = runs.length
      ? await tx
          .select({
            runId: exportJobs.runId,
            userId: exportJobs.createdBy,
            status: exportJobs.status,
            rows: exportJobs.rowCount,
            error: exportJobs.error,
            expiresAt: exportJobs.expiresAt,
          })
          .from(exportJobs)
          .where(
            and(
              eq(exportJobs.tenantId, access.tenantId),
              inArray(
                exportJobs.runId,
                runs.map((run) => run.id),
              ),
            ),
          )
      : [];
    const people = await this.people.facts(
      tx,
      access.tenantId,
      jobs.map((job) => job.userId),
    );
    const now = new Date();
    const result: ReportScheduleRun[] = runs.map((run) => ({
      id: run.id,
      sendDate: run.sendDate,
      period: run.period,
      createdAt: run.createdAt.toISOString(),
      exports: jobs
        .filter((job) => job.runId === run.id)
        .map((job) => ({
          user: {
            id: job.userId,
            code: people.get(job.userId)?.code ?? '',
            name: people.get(job.userId)?.name ?? '',
          },
          status: (job.status === 'ready' && job.expiresAt !== null && job.expiresAt <= now
            ? 'expired'
            : job.status) as ExportStatus,
          rows: job.rows,
          error: job.error,
        })),
    }));
    return { ...(await this.results(tx, access, [row]))[0]!, runs: result };
  }

  /**
   * The look every 15 minutes (the `exports` queue): each running schedule that owes a send makes
   * it, once, by its run's key (BR-52). An owner who may no longer schedule pauses the schedule;
   * each recipient's export then runs as them, and fails for anyone who may no longer export.
   */
  async due(tenantId: string, at = new Date()): Promise<void> {
    const queued: string[] = [];
    await this.database.forTenant(tenantId, async (tx) => {
      const { timezone, modulesOff } = await this.config.settings(tx, tenantId);
      // Switched off, nothing sends; switched on again, only the latest moment can.
      if (modulesOff.includes('advanced_analytics')) return;
      const now = momentIn(timezone, at);
      const running = await tx
        .select()
        .from(reportSchedules)
        .where(
          and(
            eq(reportSchedules.tenantId, tenantId),
            eq(reportSchedules.status, 'active'),
            isNull(reportSchedules.endedAt),
          ),
        )
        .orderBy(reportSchedules.id)
        .for('update', { skipLocked: true });
      let sent = 0;
      for (const schedule of running) {
        if (sent >= DUE_BATCH) break;
        const sendDate = sendDue(timingOf(schedule), momentIn(timezone, schedule.activeFrom), now);
        if (!sendDate) continue;
        const target = { type: 'report_schedule', id: schedule.id };
        const owner = await this.access
          .onBehalfOf(tenantId, schedule.ownerId, this.settings.CELL_ID)
          .catch(() => null);
        if (!owner?.permissions.has('report.schedule')) {
          await tx
            .update(reportSchedules)
            .set({ status: 'paused', pausedReason: 'owner_access', updatedAt: at })
            .where(
              and(eq(reportSchedules.tenantId, tenantId), eq(reportSchedules.id, schedule.id)),
            );
          await this.audit.record(tx, tenantId, SYSTEM_ACTOR, {
            action: 'report_schedule.paused',
            target,
            after: { reason: 'owner_access' },
          });
          continue;
        }
        const period = scheduledPeriod(schedule.frequency, sendDate);
        const [run] = await tx
          .insert(reportScheduleRuns)
          .values({ id: newId(), tenantId, scheduleId: schedule.id, sendDate, period })
          .onConflictDoNothing()
          .returning();
        if (!run) continue;
        sent += 1;
        const recipients =
          (await this.recipientsOf(tx, tenantId, [schedule.id])).get(schedule.id) ?? [];
        for (const userId of recipients) {
          const id = newId();
          const filters = { ...schedule.filters, period };
          await tx.insert(exportJobs).values({
            id,
            tenantId,
            report: schedule.report,
            filters,
            format: schedule.format,
            locale: schedule.locale,
            createdBy: userId,
            scheduleId: schedule.id,
            runId: run.id,
          });
          await this.audit.record(tx, tenantId, SYSTEM_ACTOR, {
            action: 'export.created',
            target: { type: 'export', id },
            after: {
              report: schedule.report,
              filters,
              format: schedule.format,
              scheduleId: schedule.id,
              userId,
            },
          });
          queued.push(id);
        }
      }
    });
    for (const exportId of queued) {
      await this.queues.add(
        'exports',
        'exports.run',
        { tenantId, exportId },
        { jobId: `export.run.${exportId}` },
      );
    }
    if (queued.length > 0) this.logger.log(`Queued ${queued.length} scheduled exports.`);
  }

  /**
   * An erased person (decision D95) receives no schedule and owns none: they leave every schedule
   * and the schedules they own end. What was sent stays with its exports.
   */
  async erasePerson(tx: TenantTx, tenantId: string, userId: string): Promise<void> {
    const now = new Date();
    await tx
      .update(reportScheduleRecipients)
      .set({ leftAt: now })
      .where(
        and(
          eq(reportScheduleRecipients.tenantId, tenantId),
          eq(reportScheduleRecipients.userId, userId),
          isNull(reportScheduleRecipients.leftAt),
        ),
      );
    await tx
      .update(reportSchedules)
      .set({ endedAt: now, updatedAt: now })
      .where(
        and(
          eq(reportSchedules.tenantId, tenantId),
          eq(reportSchedules.ownerId, userId),
          isNull(reportSchedules.endedAt),
        ),
      );
  }
}
