import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AppError,
  type CloseDataRequestBody,
  DATA_EXPORT_LINK_HOURS,
  type DataRequestKindKey,
  type DataRequestResult,
  dataExportExpiry,
  dataRequestCloseIssue,
  dataRequestDueOn,
  dataRequestRaiseIssue,
  dataRequestReminderDue,
  type RaiseDataRequestBody,
  todayIn,
} from '@thelamp/shared';
import { and, desc, eq, inArray, lt, ne } from 'drizzle-orm';
import { dataRequests } from '../../db/schema/governance';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { Outbox } from '../../platform/outbox';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { ShiftsService } from '../field/shifts.service';
import { notFound } from '../iam/actor';
import { People } from '../iam/people';
import { MediaService } from '../media/media.service';
import { MediaUrls } from '../media/media-urls';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { TenantArchive } from './tenant-archive';

type Row = typeof dataRequests.$inferSelect;

const ARCHIVE = 'data_requests.archive';
const UPKEEP = 'data_requests.upkeep';
const HOUR_MS = 60 * 60_000;
/** Who answers personal data requests: the tenant's admins. */
const ANSWERS = 'settings.manage';

/**
 * Requests from people about their personal data (module M21, spec 13.3, decision D95). A person
 * raises one on their phone, or an admin logs it for them; the admins are told at once and again
 * 7 days before it is due, 30 days on. Access is answered with a signed archive of the person's own
 * rows and files, correction by changing their profile, and erasure, once they are deactivated, by
 * anonymising them: their name, contact details, custom fields, whereabouts, selfies and
 * notifications go, their sign-in is forgotten, and what they did stays.
 */
@Injectable()
export class DataRequestsService implements OnModuleInit {
  private readonly logger = new Logger(DataRequestsService.name);

  constructor(
    private readonly database: Database,
    private readonly archive: TenantArchive,
    private readonly people: People,
    private readonly media: MediaService,
    private readonly urls: MediaUrls,
    private readonly shifts: ShiftsService,
    private readonly notifications: NotificationsService,
    private readonly config: TenantConfigService,
    private readonly outbox: Outbox,
    private readonly audit: AuditLog,
    private readonly queues: Queues,
    private readonly schedules: Schedules,
  ) {}

  onModuleInit(): void {
    this.queues.handle(
      'exports',
      ARCHIVE,
      (data) => this.runArchive(String(data.tenantId), String(data.requestId)),
      { perTenant: true },
    );
    this.queues.handle('maintenance', UPKEEP, (data) => this.upkeep(String(data.tenantId)));
    this.schedules.everyForTenants({
      name: UPKEEP,
      everyMs: HOUR_MS,
      queue: 'maintenance',
      kind: UPKEEP,
    });
  }

  /** The caller's own request, raised on their phone. */
  async raiseOwn(tx: TenantTx, access: Access, body: RaiseDataRequestBody) {
    if (access.support || access.apiClient) {
      throw new AppError('FORBIDDEN', 'Only the person themselves raises their own request.');
    }
    return this.raise(tx, access, access.userId, body, true);
  }

  /** A request an admin logs for someone who made it another way. */
  async log(tx: TenantTx, access: Access, userId: string, body: RaiseDataRequestBody) {
    return this.raise(tx, access, userId, body, false);
  }

  private async raise(
    tx: TenantTx,
    access: Access,
    userId: string,
    body: RaiseDataRequestBody,
    self: boolean,
  ): Promise<DataRequestResult> {
    const tenantId = access.tenantId;
    const [existing] = await tx
      .select()
      .from(dataRequests)
      .where(and(eq(dataRequests.tenantId, tenantId), eq(dataRequests.id, body.id)));
    if (existing) {
      if (existing.userId !== userId) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'This ID was used for another request.');
      }
      return this.result(tx, tenantId, existing, false);
    }
    const person = (await this.people.facts(tx, tenantId, [userId])).get(userId);
    if (!person) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', [
        { path: 'userId', issue: 'There is no such person' },
      ]);
    }
    const open = await tx
      .select({ kind: dataRequests.kind })
      .from(dataRequests)
      .where(
        and(
          eq(dataRequests.tenantId, tenantId),
          eq(dataRequests.userId, userId),
          eq(dataRequests.status, 'received'),
        ),
      );
    const issue = dataRequestRaiseIssue(
      body.kind,
      open.map((row) => row.kind as DataRequestKindKey),
    );
    if (issue) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', [{ path: 'kind', issue }]);
    }
    const settings = await this.config.settings(tx, tenantId);
    const dueOn = dataRequestDueOn(todayIn(settings.timezone));
    const [row] = await tx
      .insert(dataRequests)
      .values({
        tenantId,
        id: body.id,
        userId,
        kind: body.kind,
        details: body.details,
        self,
        raisedByName: self ? person.name : await this.nameOf(tx, access),
        dueOn,
      })
      .returning();
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'data_request.raised',
      target: { type: 'data_request', id: body.id },
      after: { userId, kind: body.kind, self },
    });
    for (const admin of await this.people.holding(tx, tenantId, ANSWERS, userId)) {
      await this.notifications.notify(tx, tenantId, {
        userId: admin,
        event: 'data_request.received',
        values: { person: person.name, kind: body.kind, due: dueOn },
        link: `/settings/data-requests/${body.id}`,
        dedupeKey: `data_request.received:${body.id}`,
      });
    }
    return this.result(tx, tenantId, row!, false);
  }

  /** The tenant's requests, open ones by when they are due, closed ones newest first. */
  async list(
    tx: TenantTx,
    tenantId: string,
    status: 'open' | 'closed' | 'all',
  ): Promise<DataRequestResult[]> {
    const rows = await tx
      .select()
      .from(dataRequests)
      .where(
        and(
          eq(dataRequests.tenantId, tenantId),
          status === 'open'
            ? eq(dataRequests.status, 'received')
            : status === 'closed'
              ? ne(dataRequests.status, 'received')
              : undefined,
        ),
      )
      .orderBy(status === 'open' ? dataRequests.dueOn : desc(dataRequests.createdAt))
      .limit(200);
    return Promise.all(rows.map((row) => this.result(tx, tenantId, row, false)));
  }

  /** The caller's own requests, newest first. */
  async mine(tx: TenantTx, access: Access): Promise<DataRequestResult[]> {
    const rows = await tx
      .select()
      .from(dataRequests)
      .where(
        and(eq(dataRequests.tenantId, access.tenantId), eq(dataRequests.userId, access.userId)),
      )
      .orderBy(desc(dataRequests.createdAt))
      .limit(50);
    return Promise.all(rows.map((row) => this.result(tx, access.tenantId, row, false)));
  }

  /** One request, with a day's link to its archive while kept; reading the link is audited. */
  async get(tx: TenantTx, access: Access, id: string): Promise<DataRequestResult> {
    const result = await this.result(
      tx,
      access.tenantId,
      await this.find(tx, access.tenantId, id),
      true,
    );
    if (result.download) {
      await this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'data_request.downloaded',
        target: { type: 'data_request', id },
      });
    }
    return result;
  }

  /** Asks for the archive of an open access request; one already being prepared stays. */
  async prepareArchive(tx: TenantTx, access: Access, id: string): Promise<DataRequestResult> {
    const row = await this.find(tx, access.tenantId, id, true);
    if (row.kind !== 'access' || row.status !== 'received') {
      throw new AppError('CONFLICT', 'Only an open access request has an archive prepared.');
    }
    if (row.archiveStatus === 'queued' || row.archiveStatus === 'running') {
      return this.result(tx, access.tenantId, row, false);
    }
    const [updated] = await tx
      .update(dataRequests)
      .set({ archiveStatus: 'queued' })
      .where(and(eq(dataRequests.tenantId, access.tenantId), eq(dataRequests.id, id)))
      .returning();
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'data_request.archived',
      target: { type: 'data_request', id },
    });
    const run = Date.now();
    this.database.afterCommit(tx, () =>
      this.queues.add(
        'exports',
        ARCHIVE,
        { tenantId: access.tenantId, requestId: id },
        { jobId: `data-request.archive.${id}.${run}` },
      ),
    );
    return this.result(tx, access.tenantId, updated!, false);
  }

  /**
   * Answers a request: refused with the reason, or completed. An erasure completes by erasing,
   * in the same transaction, so a request is never marked done with the data still there.
   */
  async close(
    tx: TenantTx,
    access: Access,
    id: string,
    body: CloseDataRequestBody,
  ): Promise<DataRequestResult> {
    const tenantId = access.tenantId;
    const row = await this.find(tx, tenantId, id, true);
    const person = (await this.people.facts(tx, tenantId, [row.userId])).get(row.userId);
    const issue = dataRequestCloseIssue({
      kind: row.kind as DataRequestKindKey,
      status: row.status as 'received',
      outcome: body.outcome,
      response: body.response,
      archiveReady: row.archiveStatus === 'ready',
      personActive: person?.status === 'active',
    });
    if (issue) throw new AppError('VALIDATION', 'Check the highlighted fields.', [issue]);
    const erasing = row.kind === 'erasure' && body.outcome === 'completed';
    if (erasing) await this.erase(tx, access, row.userId);
    const [updated] = await tx
      .update(dataRequests)
      .set({
        status: body.outcome,
        response: body.response,
        closedAt: new Date(),
        closedByName: await this.nameOf(tx, access),
      })
      .where(and(eq(dataRequests.tenantId, tenantId), eq(dataRequests.id, id)))
      .returning();
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'data_request.closed',
      target: { type: 'data_request', id },
      after: { outcome: body.outcome },
    });
    // An erased person has no way left to hear it; anyone else is told.
    if (!erasing) {
      await this.notifications.notify(tx, tenantId, {
        userId: row.userId,
        event: 'data_request.closed',
        values: { outcome: body.outcome, response: body.response || '—' },
        link: '/data-requests',
        dedupeKey: `data_request.closed:${id}`,
      });
    }
    return this.result(tx, tenantId, updated!, false);
  }

  /** Anonymises a deactivated person; each module removes what of theirs is personal. */
  private async erase(tx: TenantTx, access: Access, userId: string): Promise<void> {
    const tenantId = access.tenantId;
    await this.people.anonymise(tx, tenantId, userId);
    const points = await this.shifts.erasePerson(tx, tenantId, userId);
    const selfies = await this.media.eraseSelfies(tx, tenantId, userId);
    await this.notifications.erasePerson(tx, tenantId, userId);
    await this.outbox.publish(tx, tenantId, 'user.erased', userId, { userId });
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'user.erased',
      target: { type: 'user', id: userId },
      after: { locationPoints: points, selfies },
    });
  }

  /**
   * Writes an access request's archive (the `exports` queue): the person's own rows in one
   * snapshot, then their files, signed; kept 7 days.
   */
  async runArchive(tenantId: string, id: string): Promise<void> {
    const claimed = await this.database.forTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(dataRequests)
        .where(and(eq(dataRequests.tenantId, tenantId), eq(dataRequests.id, id)))
        .for('update');
      if (!row || (row.archiveStatus !== 'queued' && row.archiveStatus !== 'running')) return null;
      await tx
        .update(dataRequests)
        .set({ archiveStatus: 'running' })
        .where(and(eq(dataRequests.tenantId, tenantId), eq(dataRequests.id, id)));
      return row;
    });
    if (!claimed) return;
    const folder = await mkdtemp(join(tmpdir(), 'personal-archive-'));
    const path = join(folder, 'archive.zip');
    try {
      const facts = await this.database.forTenant(
        tenantId,
        (tx) => this.archive.write(tx, tenantId, path, 'personal', claimed.userId),
        { isolation: 'repeatable read', readOnly: true },
      );
      await this.database.forTenant(tenantId, async (tx) => {
        const stored = await this.media.storeFile(tx, tenantId, {
          kind: 'personal_export',
          fileName: `personal-data-${new Date().toISOString().slice(0, 10)}.zip`,
          contentType: 'application/zip',
          path,
          size: facts.bytes,
          sha256: facts.sha256,
          userId: claimed.userId,
          ownerType: 'data_request',
          ownerId: id,
          retentionClass: 'export_file',
        });
        await tx
          .update(dataRequests)
          .set({
            archiveStatus: 'ready',
            archiveMediaId: stored.id,
            archiveSize: facts.bytes,
            archiveSha256: facts.sha256,
            archiveExpiresAt: dataExportExpiry(new Date()),
          })
          .where(and(eq(dataRequests.tenantId, tenantId), eq(dataRequests.id, id)));
      });
    } catch (error) {
      this.logger.error(
        `The archive of request ${id} failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      await this.database.forTenant(tenantId, (tx) =>
        tx
          .update(dataRequests)
          .set({ archiveStatus: 'failed' })
          .where(and(eq(dataRequests.tenantId, tenantId), eq(dataRequests.id, id))),
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  /**
   * The hourly upkeep: reminds the admins of requests due within 7 days, once each, and removes
   * archives whose 7 days are over.
   */
  async upkeep(tenantId: string, now = new Date()): Promise<void> {
    await this.database.forTenant(tenantId, async (tx) => {
      const today = todayIn((await this.config.settings(tx, tenantId)).timezone, now);
      const open = await tx
        .select()
        .from(dataRequests)
        .where(and(eq(dataRequests.tenantId, tenantId), eq(dataRequests.status, 'received')));
      for (const row of open.filter((item) => dataRequestReminderDue(item.dueOn, today))) {
        const person = (await this.people.facts(tx, tenantId, [row.userId])).get(row.userId);
        for (const admin of await this.people.holding(tx, tenantId, ANSWERS, row.userId)) {
          await this.notifications.notify(tx, tenantId, {
            userId: admin,
            event: 'data_request.due_soon',
            values: { person: person?.name ?? '', due: row.dueOn },
            link: `/settings/data-requests/${row.id}`,
            dedupeKey: `data_request.due_soon:${row.id}`,
          });
        }
      }
      const expired = await tx
        .select({ id: dataRequests.id, mediaId: dataRequests.archiveMediaId })
        .from(dataRequests)
        .where(
          and(
            eq(dataRequests.tenantId, tenantId),
            eq(dataRequests.archiveStatus, 'ready'),
            lt(dataRequests.archiveExpiresAt, now),
          ),
        );
      for (const row of expired) {
        if (row.mediaId) await this.media.expire(tx, tenantId, row.mediaId);
      }
      if (expired.length > 0) {
        await tx
          .update(dataRequests)
          .set({ archiveStatus: 'expired' })
          .where(
            and(
              eq(dataRequests.tenantId, tenantId),
              inArray(
                dataRequests.id,
                expired.map((row) => row.id),
              ),
            ),
          );
      }
    });
  }

  private async find(tx: TenantTx, tenantId: string, id: string, lock = false): Promise<Row> {
    const query = tx
      .select()
      .from(dataRequests)
      .where(and(eq(dataRequests.tenantId, tenantId), eq(dataRequests.id, id)));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw notFound();
    return row;
  }

  private async nameOf(tx: TenantTx, access: Access): Promise<string> {
    if (access.support) return access.support.staffName;
    return (
      (await this.people.facts(tx, access.tenantId, [access.userId])).get(access.userId)?.name ?? ''
    );
  }

  private async result(
    tx: TenantTx,
    tenantId: string,
    row: Row,
    withLink: boolean,
    now = new Date(),
  ): Promise<DataRequestResult> {
    const person = (await this.people.facts(tx, tenantId, [row.userId])).get(row.userId);
    const kept =
      row.archiveStatus === 'ready' && row.archiveExpiresAt !== null && row.archiveExpiresAt > now;
    const key =
      withLink && kept && row.archiveMediaId
        ? await this.media.objectKey(tx, tenantId, row.archiveMediaId)
        : null;
    return {
      id: row.id,
      person: { id: row.userId, name: person?.name ?? '', code: person?.code ?? '' },
      kind: row.kind as DataRequestKindKey,
      status: row.status as DataRequestResult['status'],
      details: row.details,
      response: row.response,
      raisedBy: { self: row.self, name: row.raisedByName },
      dueOn: row.dueOn,
      createdAt: row.createdAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      closedBy: row.closedByName,
      archive: row.archiveStatus
        ? {
            status: (row.archiveStatus === 'ready' && !kept
              ? 'expired'
              : row.archiveStatus) as NonNullable<DataRequestResult['archive']>['status'],
            bytes: row.archiveSize,
            sha256: row.archiveSha256,
            expiresAt: row.archiveExpiresAt?.toISOString() ?? null,
          }
        : null,
      download: key ? await this.urls.read(key, DATA_EXPORT_LINK_HOURS * 3600) : null,
    };
  }
}
