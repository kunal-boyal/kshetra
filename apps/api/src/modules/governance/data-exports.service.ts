import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AppError,
  type ArchiveSigningKey,
  DATA_EXPORT_LINK_HOURS,
  type DataExportResult,
  dataExportExpiry,
} from '@thelamp/shared';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { dataExports } from '../../db/schema/governance';
import { ArchiveSigner } from '../../platform/archive-signer';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { notFound } from '../iam/actor';
import { People } from '../iam/people';
import { MediaService } from '../media/media.service';
import { MediaUrls } from '../media/media-urls';
import { TenantArchive } from './tenant-archive';

type Row = typeof dataExports.$inferSelect;

const RUN = 'data_exports.run';
const EXPIRE = 'data_exports.expire';
const HOUR_MS = 60 * 60_000;
/** An export still queued after this long was never handed to the queue. */
const STUCK_AFTER_MS = 5 * 60_000;
const jobId = (id: string) => `data-export.run.${id}`;

/**
 * Tenant data exports (module M21, spec 13.3, decision D95). A tenant admin asks for one; the
 * worker writes the signed archive of everything the tenant holds and keeps it for seven days; any
 * of the tenant's admins may download it through a link that lasts a day. One is prepared at a time,
 * and every request and download is in the audit log.
 */
@Injectable()
export class DataExportsService implements OnModuleInit {
  private readonly logger = new Logger(DataExportsService.name);

  constructor(
    private readonly database: Database,
    private readonly archive: TenantArchive,
    private readonly signer: ArchiveSigner,
    private readonly media: MediaService,
    private readonly urls: MediaUrls,
    private readonly people: People,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
    private readonly audit: AuditLog,
  ) {}

  onModuleInit(): void {
    this.queues.handle('exports', RUN, (data) =>
      this.run(String(data.tenantId), String(data.exportId)),
    );
    this.queues.handle('exports', EXPIRE, (data) => this.expire(String(data.tenantId)));
    this.schedules.everyForTenants({
      name: EXPIRE,
      everyMs: HOUR_MS,
      queue: 'exports',
      kind: EXPIRE,
    });
  }

  /** The key archives are signed with, so a download can be checked. */
  signingKey(): ArchiveSigningKey {
    return { keyId: this.signer.keyId, algorithm: 'Ed25519', publicKey: this.signer.publicKeyPem };
  }

  private async result(
    tx: TenantTx,
    tenantId: string,
    row: Row,
    withLink: boolean,
    now = new Date(),
  ): Promise<DataExportResult> {
    const kept = row.status === 'ready' && row.expiresAt !== null && row.expiresAt > now;
    const key =
      withLink && kept && row.fileMediaId
        ? await this.media.objectKey(tx, tenantId, row.fileMediaId)
        : null;
    return {
      id: row.id,
      // A file past its keeping time reads as expired even before the hourly sweep removes it.
      status: (row.status === 'ready' && !kept
        ? 'expired'
        : row.status) as DataExportResult['status'],
      requestedBy: { id: row.requestedBy, name: row.requesterName },
      fileName: row.fileName,
      bytes: row.size,
      sha256: row.sha256,
      tables: row.tableCount,
      rows: row.rowCount,
      files: row.fileCount,
      keyId: row.keyId,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      download: key ? await this.urls.read(key, DATA_EXPORT_LINK_HOURS * 3600) : null,
    };
  }

  private async find(tx: TenantTx, tenantId: string, id: string): Promise<Row> {
    const [row] = await tx
      .select()
      .from(dataExports)
      .where(and(eq(dataExports.tenantId, tenantId), eq(dataExports.id, id)));
    if (!row) throw notFound();
    return row;
  }

  /** Asks for an archive; one already being prepared answers `CONFLICT`. */
  async create(tx: TenantTx, access: Access, id: string): Promise<DataExportResult> {
    const [existing] = await tx
      .select()
      .from(dataExports)
      .where(and(eq(dataExports.tenantId, access.tenantId), eq(dataExports.id, id)));
    if (existing) return this.result(tx, access.tenantId, existing, false);
    const [busy] = await tx
      .select({ id: dataExports.id })
      .from(dataExports)
      .where(
        and(
          eq(dataExports.tenantId, access.tenantId),
          inArray(dataExports.status, ['queued', 'running']),
        ),
      )
      .for('update');
    if (busy) {
      throw new AppError('CONFLICT', 'An export of your data is being prepared already.');
    }
    const requesterName = access.support
      ? access.support.staffName
      : ((await this.people.facts(tx, access.tenantId, [access.userId])).get(access.userId)?.name ??
        '');
    const [row] = await tx
      .insert(dataExports)
      .values({
        tenantId: access.tenantId,
        id,
        requestedBy: access.support ? null : access.userId,
        requesterName,
      })
      .returning();
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'data_export.created',
      target: { type: 'data_export', id },
    });
    this.database.afterCommit(tx, () =>
      this.queues.add(
        'exports',
        RUN,
        { tenantId: access.tenantId, exportId: id },
        { jobId: jobId(id) },
      ),
    );
    return this.result(tx, access.tenantId, row!, false);
  }

  /** The tenant's exports, newest first; links come only from `get`. */
  async list(tx: TenantTx, tenantId: string): Promise<DataExportResult[]> {
    const rows = await tx
      .select()
      .from(dataExports)
      .where(eq(dataExports.tenantId, tenantId))
      .orderBy(desc(dataExports.createdAt), desc(dataExports.id))
      .limit(50);
    const now = new Date();
    return Promise.all(rows.map((row) => this.result(tx, tenantId, row, false, now)));
  }

  /** One export, with a day's link while its archive is kept; reading the link is audited. */
  async get(tx: TenantTx, access: Access, id: string): Promise<DataExportResult> {
    const result = await this.result(
      tx,
      access.tenantId,
      await this.find(tx, access.tenantId, id),
      true,
    );
    if (result.download) {
      await this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'data_export.downloaded',
        target: { type: 'data_export', id },
      });
    }
    return result;
  }

  /**
   * Writes the archive (the `exports` queue): the tables in one snapshot, then the files, to a
   * temporary file, which is stored and removed. Running it again after a failure starts afresh.
   */
  async run(tenantId: string, id: string): Promise<void> {
    const claimed = await this.database.forTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(dataExports)
        .where(and(eq(dataExports.tenantId, tenantId), eq(dataExports.id, id)))
        .for('update');
      if (!row || (row.status !== 'queued' && row.status !== 'running')) return null;
      await tx
        .update(dataExports)
        .set({ status: 'running' })
        .where(and(eq(dataExports.tenantId, tenantId), eq(dataExports.id, id)));
      return row;
    });
    if (!claimed) return;
    const folder = await mkdtemp(join(tmpdir(), 'tenant-archive-'));
    const path = join(folder, 'archive.zip');
    try {
      const facts = await this.database.forTenant(
        tenantId,
        (tx) => this.archive.write(tx, tenantId, path),
        { isolation: 'repeatable read', readOnly: true },
      );
      const day = new Date().toISOString().slice(0, 10);
      const fileName = `data-export-${day}.zip`;
      await this.database.forTenant(tenantId, async (tx) => {
        const stored = await this.media.storeFile(tx, tenantId, {
          kind: 'tenant_export',
          fileName,
          contentType: 'application/zip',
          path,
          size: facts.bytes,
          sha256: facts.sha256,
          userId: claimed.requestedBy,
          ownerType: 'data_export',
          ownerId: id,
          retentionClass: 'export_file',
        });
        const finishedAt = new Date();
        await tx
          .update(dataExports)
          .set({
            status: 'ready',
            fileMediaId: stored.id,
            fileName,
            size: facts.bytes,
            sha256: facts.sha256,
            tableCount: facts.tables,
            rowCount: facts.rows,
            fileCount: facts.files,
            keyId: facts.keyId,
            finishedAt,
            expiresAt: dataExportExpiry(finishedAt),
          })
          .where(and(eq(dataExports.tenantId, tenantId), eq(dataExports.id, id)));
      });
    } catch (error) {
      this.logger.error(
        `Data export ${id} failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      await this.database.forTenant(tenantId, (tx) =>
        tx
          .update(dataExports)
          .set({
            status: 'failed',
            error: 'The archive could not be prepared. Ask again, or contact support.',
            finishedAt: new Date(),
          })
          .where(and(eq(dataExports.tenantId, tenantId), eq(dataExports.id, id))),
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  /**
   * The hourly upkeep: removes archives whose seven days are over, marking them expired, and
   * queues again an export still waiting after a few minutes, whose queueing failed after commit.
   */
  async expire(tenantId: string, now = new Date()): Promise<void> {
    await this.database.forTenant(tenantId, async (tx) => {
      const waiting = await tx
        .select({ id: dataExports.id })
        .from(dataExports)
        .where(
          and(
            eq(dataExports.tenantId, tenantId),
            eq(dataExports.status, 'queued'),
            lt(dataExports.createdAt, new Date(now.getTime() - STUCK_AFTER_MS)),
          ),
        );
      for (const row of waiting) {
        await this.queues.add(
          'exports',
          RUN,
          { tenantId, exportId: row.id },
          { jobId: jobId(row.id) },
        );
      }
      const due = await tx
        .select({ id: dataExports.id, fileMediaId: dataExports.fileMediaId })
        .from(dataExports)
        .where(
          and(
            eq(dataExports.tenantId, tenantId),
            eq(dataExports.status, 'ready'),
            lt(dataExports.expiresAt, now),
          ),
        );
      for (const row of due) {
        if (row.fileMediaId) await this.media.expire(tx, tenantId, row.fileMediaId);
        await tx
          .update(dataExports)
          .set({ status: 'expired' })
          .where(and(eq(dataExports.tenantId, tenantId), eq(dataExports.id, row.id)));
      }
    });
  }
}
