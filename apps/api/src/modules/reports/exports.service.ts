import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AppError,
  type CreateExportBody,
  type ExportListResult,
  type ExportResult,
  exportExpiry,
  type Locale,
  type ReportFilters,
  type ReportKey,
} from '@thelamp/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Config } from '../../config';
import { exportJobs } from '../../db/schema/reports';
import { AuditLog, userActor } from '../../platform/audit';
import { type Access, AccessResolver } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { CONFIG } from '../../platform/tokens';
import { notFound } from '../iam/actor';
import { MediaService } from '../media/media.service';
import { MediaUrls } from '../media/media-urls';
import { toCsv, toXlsx } from './files';
import { ReportsService } from './reports.service';

type Job = typeof exportJobs.$inferSelect;

const TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

/** How often each tenant's expired files are removed and stuck exports queued again. */
const EXPIRY_EVERY_MS = 60 * 60_000;

/** An export still queued after this long was never handed to the queue. */
const STUCK_AFTER_MS = 5 * 60_000;

/**
 * Exports (module M18, decision D62). Asking for one records it and queues it; the worker reads
 * every row as the person may see them now, writes the file and keeps it for seven days; the person
 * hears when it is ready and downloads it through a short-lived link. Only the person who asked
 * sees an export, and every request and download is in the audit log.
 */
@Injectable()
export class ExportsService implements OnModuleInit {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    private readonly database: Database,
    private readonly reports: ReportsService,
    private readonly media: MediaService,
    private readonly urls: MediaUrls,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
    private readonly access: AccessResolver,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  onModuleInit(): void {
    this.queues.handle('exports', 'exports.run', (data) =>
      this.run(String(data.tenantId), String(data.exportId)),
    );
    this.queues.handle('exports', 'exports.expire', (data) => this.expire(String(data.tenantId)));
    this.schedules.everyForTenants({
      name: 'exports.expire',
      everyMs: EXPIRY_EVERY_MS,
      queue: 'exports',
      kind: 'exports.expire',
    });
  }

  private async result(
    tx: TenantTx,
    tenantId: string,
    job: Job,
    now = new Date(),
  ): Promise<ExportResult> {
    const ready = job.status === 'ready' && job.expiresAt !== null && job.expiresAt > now;
    const key =
      ready && job.fileMediaId ? await this.media.objectKey(tx, tenantId, job.fileMediaId) : null;
    return {
      id: job.id,
      report: job.report as ReportKey,
      filters: job.filters,
      format: job.format as ExportResult['format'],
      // A file past its keeping time reads as expired even before the hourly sweep removes it.
      status: job.status === 'ready' && !ready ? 'expired' : job.status,
      rows: job.rowCount,
      fileName: job.fileName,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
      expiresAt: job.expiresAt?.toISOString() ?? null,
      download: key ? await this.urls.read(key) : null,
    };
  }

  /** The caller's own export; anyone else's is not found. */
  private async mine(tx: TenantTx, access: Access, id: string): Promise<Job> {
    const [job] = await tx
      .select()
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.tenantId, access.tenantId),
          eq(exportJobs.id, id),
          eq(exportJobs.createdBy, access.userId),
        ),
      );
    if (!job) throw notFound();
    return job;
  }

  /** Records an export and queues it, after checking the filters reach only what the caller may see. */
  async create(tx: TenantTx, access: Access, body: CreateExportBody): Promise<ExportResult> {
    await this.reports.check(tx, access, body.report, body.filters);
    const [job] = await tx
      .insert(exportJobs)
      .values({
        id: body.id,
        tenantId: access.tenantId,
        report: body.report,
        filters: body.filters,
        format: body.format,
        locale: body.locale,
        createdBy: access.userId,
      })
      .returning();
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'export.created',
      target: { type: 'export', id: body.id },
      after: { report: body.report, filters: body.filters, format: body.format },
    });
    this.database.afterCommit(tx, () =>
      this.queues.add(
        'exports',
        'exports.run',
        { tenantId: access.tenantId, exportId: body.id },
        { jobId: `export.run.${body.id}` },
      ),
    );
    return this.result(tx, access.tenantId, job!);
  }

  /** One of the caller's exports, with a fresh link while its file is kept; reading it is audited. */
  async get(tx: TenantTx, access: Access, id: string): Promise<ExportResult> {
    const job = await this.mine(tx, access, id);
    const result = await this.result(tx, access.tenantId, job);
    if (result.download) {
      await this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'export.downloaded',
        target: { type: 'export', id },
      });
    }
    return result;
  }

  /** The caller's recent exports, newest first; links come only from `get`. */
  async list(tx: TenantTx, access: Access, limit: number): Promise<ExportListResult> {
    const jobs = await tx
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.tenantId, access.tenantId), eq(exportJobs.createdBy, access.userId)))
      .orderBy(desc(exportJobs.createdAt), desc(exportJobs.id))
      .limit(limit);
    const now = new Date();
    const items: ExportResult[] = [];
    for (const job of jobs) {
      items.push({ ...(await this.result(tx, access.tenantId, job, now)), download: null });
    }
    return { items };
  }

  private async finish(
    tx: TenantTx,
    job: Job,
    outcome:
      | { status: 'ready'; rows: number; mediaId: string; fileName: string }
      | { status: 'failed'; error: string },
  ) {
    const finishedAt = new Date();
    await tx
      .update(exportJobs)
      .set(
        outcome.status === 'ready'
          ? {
              status: 'ready',
              rowCount: outcome.rows,
              fileMediaId: outcome.mediaId,
              fileName: outcome.fileName,
              finishedAt,
              expiresAt: exportExpiry(finishedAt),
            }
          : { status: 'failed', error: outcome.error, finishedAt },
      )
      .where(and(eq(exportJobs.tenantId, job.tenantId), eq(exportJobs.id, job.id)));
    await this.outbox.publish(tx, job.tenantId, 'export.finished', job.id, {
      exportId: job.id,
      userId: job.createdBy,
      report: job.report,
      period: job.filters.period,
      status: outcome.status,
      rows: outcome.status === 'ready' ? outcome.rows : null,
    });
  }

  /**
   * Writes an export's file (the `exports` queue). It reads as the person may see now, so someone
   * who lost access while it waited gets nothing; running it again after a failure starts afresh.
   */
  async run(tenantId: string, id: string): Promise<void> {
    const job = await this.database.forTenant(tenantId, async (tx) => {
      const [found] = await tx
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.tenantId, tenantId), eq(exportJobs.id, id)))
        .for('update');
      if (!found || (found.status !== 'queued' && found.status !== 'running')) return null;
      await tx
        .update(exportJobs)
        .set({ status: 'running' })
        .where(and(eq(exportJobs.tenantId, tenantId), eq(exportJobs.id, id)));
      return found;
    });
    if (!job) return;
    // Someone deactivated or moved since asking can't be resolved: they get nothing.
    const access = await this.access
      .onBehalfOf(tenantId, job.createdBy, this.config.CELL_ID)
      .catch(() => null);
    if (!access?.permissions.has('export.create')) {
      await this.database.forTenant(tenantId, (tx) =>
        this.finish(tx, job, {
          status: 'failed',
          error: 'The person who asked for this export may no longer export.',
        }),
      );
      return;
    }
    try {
      await this.database.forTenant(tenantId, async (tx) => {
        const report = job.report as ReportKey;
        const data = await this.reports.everyRow(
          tx,
          access,
          report,
          job.filters as ReportFilters,
          job.locale as Locale,
        );
        const format = job.format as keyof typeof TYPES;
        const bytes =
          format === 'csv'
            ? toCsv(data.columns, data.rows, data.timezone)
            : await toXlsx(data.name, data.columns, data.rows, data.timezone);
        const fileName = `${report.replace(/_/g, '-')}-${job.filters.period}.${format}`;
        const stored = await this.media.store(tx, tenantId, {
          kind: 'export_file',
          fileName,
          contentType: TYPES[format],
          bytes,
          userId: job.createdBy,
          ownerType: 'export',
          ownerId: job.id,
          retentionClass: 'export_file',
        });
        await this.finish(tx, job, {
          status: 'ready',
          rows: data.rows.length,
          mediaId: stored.id,
          fileName,
        });
      });
    } catch (error) {
      // The work's transaction is gone; the failure is recorded in a fresh one, once.
      this.logger.error(
        `Export ${id} failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      await this.database.forTenant(tenantId, (tx) =>
        this.finish(tx, job, {
          status: 'failed',
          error: error instanceof AppError ? error.message : 'The export could not be prepared.',
        }),
      );
    }
  }

  /**
   * The hourly upkeep: removes the files of exports whose seven days are over and marks them
   * expired, and queues again any export still waiting after a few minutes, as one whose queueing
   * failed after its commit would otherwise wait for ever (the same job ID keeps it to one run).
   */
  async expire(tenantId: string, now = new Date()): Promise<void> {
    await this.database.forTenant(tenantId, async (tx) => {
      const waiting = await tx
        .select({ id: exportJobs.id })
        .from(exportJobs)
        .where(
          and(
            eq(exportJobs.tenantId, tenantId),
            eq(exportJobs.status, 'queued'),
            lt(exportJobs.createdAt, new Date(now.getTime() - STUCK_AFTER_MS)),
          ),
        )
        .limit(100);
      for (const job of waiting) {
        await this.queues.add(
          'exports',
          'exports.run',
          { tenantId, exportId: job.id },
          { jobId: `export.run.${job.id}` },
        );
      }
      const due = await tx
        .select({ id: exportJobs.id, fileMediaId: exportJobs.fileMediaId })
        .from(exportJobs)
        .where(
          and(
            eq(exportJobs.tenantId, tenantId),
            eq(exportJobs.status, 'ready'),
            lt(exportJobs.expiresAt, now),
          ),
        )
        .limit(500);
      for (const job of due) {
        if (job.fileMediaId) await this.media.expire(tx, tenantId, job.fileMediaId);
        await tx
          .update(exportJobs)
          .set({ status: 'expired' })
          .where(and(eq(exportJobs.tenantId, tenantId), eq(exportJobs.id, job.id)));
      }
      if (due.length > 0) this.logger.log(`Expired ${due.length} export files.`);
    });
  }
}
