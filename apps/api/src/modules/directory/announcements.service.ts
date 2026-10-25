import { Injectable } from '@nestjs/common';
import {
  AppError,
  type AnnouncementBody,
  announcementStatus,
  type AnnouncementSurfaceKey,
  type ConsoleAnnouncement,
  type TenantAnnouncement,
} from '@thelamp/shared';
import { and, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { announcements, platformUsers, tenants } from '../../db/schema/directory';
import type { StaffAccess } from '../../platform/auth';
import { DirectoryDatabase } from './directory.database';
import { PlatformAudit } from './platform-audit';

type Row = typeof announcements.$inferSelect;

/**
 * Announcements (module M22, decision D93): vendor staff write them in the console, for every
 * tenant or some, on the web, the phone or both; each tenant reads what shows for it now.
 * Withdrawing one takes it down at once; nothing is deleted.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly database: DirectoryDatabase,
    private readonly audit: PlatformAudit,
  ) {}

  /** The console's list, newest first: the last 200. */
  async list(): Promise<ConsoleAnnouncement[]> {
    const rows = await this.database.db
      .select()
      .from(announcements)
      .orderBy(desc(announcements.createdAt))
      .limit(200);
    return this.results(rows);
  }

  /** Makes an announcement under the console's ID; the same ID again returns it. */
  async create(by: StaffAccess, body: AnnouncementBody): Promise<ConsoleAnnouncement> {
    const [existing] = await this.database.db
      .select()
      .from(announcements)
      .where(eq(announcements.id, body.id));
    if (existing) {
      if (existing.title.en !== body.title.en) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'This ID was used for another announcement.');
      }
      return (await this.results([existing]))[0]!;
    }
    if (body.tenantIds) {
      const found = await this.database.db
        .select({ id: tenants.id })
        .from(tenants)
        .where(inArray(tenants.id, body.tenantIds));
      const known = new Set(found.map((row) => row.id));
      const missing = body.tenantIds.findIndex((id) => !known.has(id));
      if (missing >= 0) {
        throw new AppError('VALIDATION', 'Check the highlighted fields.', [
          { path: `tenantIds.${missing}`, issue: 'There is no such tenant' },
        ]);
      }
    }
    await this.database.db.transaction(async (tx) => {
      await tx.insert(announcements).values({
        id: body.id,
        title: body.title,
        body: body.body,
        tone: body.tone,
        surfaces: body.surfaces,
        tenantIds: body.tenantIds ? [...new Set(body.tenantIds)] : null,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        createdBy: by.staffId,
      });
      await this.audit.record(tx, by, 'announcement.created', 'announcement', body.id, {
        title: body.title.en,
        tenants: body.tenantIds?.length ?? 'all',
      });
    });
    return this.get(body.id);
  }

  /** Takes an announcement down at once. One already withdrawn or over stays as it is. */
  async withdraw(by: StaffAccess, id: string): Promise<ConsoleAnnouncement> {
    await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(announcements)
        .where(eq(announcements.id, id))
        .for('update');
      if (!row) throw new AppError('NOT_FOUND', 'There is no such announcement.');
      const status = announcementStatus(row, new Date());
      if (status === 'withdrawn' || status === 'ended') return;
      await tx
        .update(announcements)
        .set({ withdrawnAt: new Date(), withdrawnBy: by.staffId })
        .where(eq(announcements.id, id));
      await this.audit.record(tx, by, 'announcement.withdrawn', 'announcement', id, {});
    });
    return this.get(id);
  }

  /** What shows now for a tenant on one surface, the soonest to end first. */
  async current(tenantId: string, surface: AnnouncementSurfaceKey): Promise<TenantAnnouncement[]> {
    const now = new Date();
    const rows = await this.database.db
      .select()
      .from(announcements)
      .where(
        and(
          isNull(announcements.withdrawnAt),
          lte(announcements.startsAt, now),
          gt(announcements.endsAt, now),
          sql`${surface} = any(${announcements.surfaces})`,
          sql`(${announcements.tenantIds} is null or ${tenantId}::uuid = any(${announcements.tenantIds}))`,
        ),
      )
      .orderBy(announcements.endsAt);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      tone: row.tone,
      endsAt: row.endsAt.toISOString(),
    }));
  }

  private async get(id: string): Promise<ConsoleAnnouncement> {
    const rows = await this.database.db
      .select()
      .from(announcements)
      .where(eq(announcements.id, id));
    if (!rows[0]) throw new AppError('NOT_FOUND', 'There is no such announcement.');
    return (await this.results(rows))[0]!;
  }

  /** Rows with their tenants' and writers' names, as the console shows them. */
  private async results(rows: Row[]): Promise<ConsoleAnnouncement[]> {
    const tenantIds = [...new Set(rows.flatMap((row) => row.tenantIds ?? []))];
    const staffIds = [...new Set(rows.map((row) => row.createdBy))];
    const [names, writers] = await Promise.all([
      tenantIds.length
        ? this.database.db
            .select({ id: tenants.id, name: tenants.name })
            .from(tenants)
            .where(inArray(tenants.id, tenantIds))
        : [],
      staffIds.length
        ? this.database.db
            .select({ id: platformUsers.id, name: platformUsers.name })
            .from(platformUsers)
            .where(inArray(platformUsers.id, staffIds))
        : [],
    ]);
    const tenantName = new Map(names.map((row) => [row.id, row.name]));
    const writer = new Map(writers.map((row) => [row.id, row.name]));
    const now = new Date();
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      tone: row.tone,
      surfaces: row.surfaces as AnnouncementSurfaceKey[],
      tenants: row.tenantIds
        ? row.tenantIds.map((id) => ({ id, name: tenantName.get(id) ?? '' }))
        : null,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      status: announcementStatus(row, now),
      createdBy: writer.get(row.createdBy) ?? '',
      createdAt: row.createdAt.toISOString(),
      withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    }));
  }
}
