import { Injectable } from '@nestjs/common';
import { daysBefore, locationRetention, todayIn } from '@kshetra/shared';
import { and, asc, eq, gte, isNotNull, isNull, lt, max, min, sql } from 'drizzle-orm';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { locationArchives, locationPoints, shiftTrails } from '../../db/schema/field';
import { AuditLog, SYSTEM_ACTOR } from '../../platform/audit';
import { Database, type TenantTx } from '../../platform/database';
import { startOfLocalDate } from '../../platform/local-day';
import { MediaService } from '../media/media.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/** Points in one archive file, which the job holds in memory while it writes it. */
export const ARCHIVE_PART_POINTS = 200_000;
/** Points deleted in one transaction, so a purge never holds locks for long. */
const PURGE_BATCH = 10_000;
/** Days archived in one night; a tenant further behind catches up over the following nights. */
const DAYS_A_RUN = 31;

export interface RetentionRun {
  /** Days archived. */
  archived: number;
  /** Raw points deleted. */
  purged: number;
  /** Trails deleted. */
  trails: number;
  /** Archive files expired. */
  expired: number;
}

const PARQUET = 'application/vnd.apache.parquet';

/**
 * BR-41 for location data (spec 10.3, decision D69), nightly for each tenant: the raw points of
 * each settled day are written to the object store as Parquet, a day's points leave the database
 * once archived and past the tenant's raw retention, and trails and archive files go after the
 * trail retention. Every step can run again: archived days aren't archived twice, and deleting
 * what is already gone deletes nothing. Every deletion run is in the audit log.
 */
@Injectable()
export class LocationArchive {
  constructor(
    private readonly database: Database,
    private readonly config: TenantConfigService,
    private readonly media: MediaService,
    private readonly audit: AuditLog,
  ) {}

  /** `today` is the tenant's new day. */
  async run(tenantId: string, today: string): Promise<RetentionRun> {
    const settings = await this.database.forTenant(tenantId, (tx) =>
      this.config.settings(tx, tenantId),
    );
    const rules = locationRetention({ today, ...settings });
    const zone = settings.timezone;
    let archived = 0;
    for (let count = 0; count < DAYS_A_RUN; count++) {
      const date = await this.database.forTenant(tenantId, (tx) =>
        this.nextDay(tx, tenantId, zone),
      );
      if (date === null || date > rules.archiveThrough) break;
      await this.database.forTenant(tenantId, (tx) => this.archive(tx, tenantId, date, zone));
      archived++;
    }
    let purged = 0;
    for (const date of await this.purgeable(tenantId, rules.purgeBefore)) {
      purged += await this.purge(tenantId, date, zone);
    }
    const { trails, expired } = await this.database.forTenant(tenantId, (tx) =>
      this.removeOld(tx, tenantId, rules.trailsBefore),
    );
    return { archived, purged, trails, expired };
  }

  /** The first day after the last archived one that has points, on the tenant's clock. */
  private async nextDay(tx: TenantTx, tenantId: string, zone: string): Promise<string | null> {
    const [last] = await tx
      .select({ date: max(locationArchives.date) })
      .from(locationArchives)
      .where(eq(locationArchives.tenantId, tenantId));
    const from = last?.date ? startOfLocalDate(daysBefore(last.date, -1), zone) : null;
    const [first] = await tx
      .select({ at: min(locationPoints.capturedAt) })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.tenantId, tenantId),
          from ? gte(locationPoints.capturedAt, from) : undefined,
        ),
      );
    return first?.at ? todayIn(zone, first.at) : null;
  }

  /** Writes a day's points as files of up to ARCHIVE_PART_POINTS points, in time order. */
  async archive(tx: TenantTx, tenantId: string, date: string, zone: string): Promise<number> {
    const from = startOfLocalDate(date, zone);
    const to = startOfLocalDate(daysBefore(date, -1), zone);
    let after: { at: string; id: string } | null = null;
    let points = 0;
    let part = 0;
    for (;;) {
      const rows: (ArchivedPoint & { cursor: string })[] = await tx
        .select({
          id: locationPoints.id,
          shiftId: locationPoints.shiftId,
          userId: locationPoints.userId,
          capturedAt: locationPoints.capturedAt,
          // The cursor keeps the database's microseconds, which a Date would round away.
          cursor: sql<string>`${locationPoints.capturedAt}::text`,
          receivedAt: locationPoints.receivedAt,
          lat: sql<number>`ST_Y(${locationPoints.point}::geometry)`,
          lng: sql<number>`ST_X(${locationPoints.point}::geometry)`,
          accuracy: locationPoints.accuracy,
          speed: locationPoints.speed,
          source: locationPoints.source,
          battery: locationPoints.battery,
        })
        .from(locationPoints)
        .where(
          and(
            eq(locationPoints.tenantId, tenantId),
            gte(locationPoints.capturedAt, from),
            lt(locationPoints.capturedAt, to),
            after
              ? sql`(${locationPoints.capturedAt}, ${locationPoints.id}) > (${after.at}::timestamptz, ${after.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(asc(locationPoints.capturedAt), asc(locationPoints.id))
        .limit(ARCHIVE_PART_POINTS);
      if (rows.length === 0 && part > 0) break;
      const stored =
        rows.length === 0
          ? null
          : await this.media.store(tx, tenantId, {
              kind: 'location_archive',
              fileName: `locations-${date}-${part}.parquet`,
              contentType: PARQUET,
              bytes: new Uint8Array(parquetFile(rows)),
              userId: null,
              ownerType: 'location_archive',
              ownerId: null,
              retentionClass: 'location_archive',
            });
      await tx.insert(locationArchives).values({
        tenantId,
        date,
        part,
        mediaId: stored?.id ?? null,
        points: rows.length,
      });
      points += rows.length;
      part++;
      if (rows.length < ARCHIVE_PART_POINTS) break;
      const last = rows[rows.length - 1]!;
      after = { at: last.cursor, id: last.id };
    }
    await this.audit.record(tx, tenantId, SYSTEM_ACTOR, {
      action: 'locations.archived',
      target: { type: 'location_archive', id: null },
      after: { date, parts: part, points },
    });
    return points;
  }

  /** Archived days before `before` whose points are still in the database. */
  private async purgeable(tenantId: string, before: string): Promise<string[]> {
    const days = await this.database.forTenant(tenantId, (tx) =>
      tx
        .selectDistinct({ date: locationArchives.date })
        .from(locationArchives)
        .where(
          and(
            eq(locationArchives.tenantId, tenantId),
            lt(locationArchives.date, before),
            isNull(locationArchives.purgedAt),
          ),
        )
        .orderBy(asc(locationArchives.date)),
    );
    return days.map((day) => day.date);
  }

  /** Deletes an archived day's points in batches, then marks the day purged. */
  private async purge(tenantId: string, date: string, zone: string): Promise<number> {
    const from = startOfLocalDate(date, zone);
    const to = startOfLocalDate(daysBefore(date, -1), zone);
    const inDay = and(
      eq(locationPoints.tenantId, tenantId),
      gte(locationPoints.capturedAt, from),
      lt(locationPoints.capturedAt, to),
    );
    let purged = 0;
    for (;;) {
      const gone = await this.database.forTenant(tenantId, (tx) =>
        tx
          .delete(locationPoints)
          .where(
            and(
              inDay,
              sql`(${locationPoints.capturedAt}, ${locationPoints.id}) in (${tx
                .select({ capturedAt: locationPoints.capturedAt, id: locationPoints.id })
                .from(locationPoints)
                .where(inDay)
                .limit(PURGE_BATCH)})`,
            ),
          )
          .returning({ id: locationPoints.id }),
      );
      purged += gone.length;
      if (gone.length < PURGE_BATCH) break;
    }
    await this.database.forTenant(tenantId, async (tx) => {
      await tx
        .update(locationArchives)
        .set({ purgedAt: new Date() })
        .where(and(eq(locationArchives.tenantId, tenantId), eq(locationArchives.date, date)));
      await this.audit.record(tx, tenantId, SYSTEM_ACTOR, {
        action: 'retention.applied',
        target: { type: 'location_points', id: null },
        after: { date, deleted: purged },
      });
    });
    return purged;
  }

  /** Deletes trails before `before`, and expires the archive files of those days. */
  private async removeOld(tx: TenantTx, tenantId: string, before: string) {
    const trails = await tx
      .delete(shiftTrails)
      .where(and(eq(shiftTrails.tenantId, tenantId), lt(shiftTrails.date, before)))
      .returning({ shiftId: shiftTrails.shiftId });
    const files = await tx
      .select({ mediaId: locationArchives.mediaId })
      .from(locationArchives)
      .where(
        and(
          eq(locationArchives.tenantId, tenantId),
          lt(locationArchives.date, before),
          isNull(locationArchives.expiredAt),
          isNotNull(locationArchives.mediaId),
        ),
      );
    for (const file of files) await this.media.expire(tx, tenantId, file.mediaId!);
    await tx
      .update(locationArchives)
      .set({ expiredAt: new Date() })
      .where(
        and(
          eq(locationArchives.tenantId, tenantId),
          lt(locationArchives.date, before),
          isNull(locationArchives.expiredAt),
        ),
      );
    if (trails.length > 0) {
      await this.audit.record(tx, tenantId, SYSTEM_ACTOR, {
        action: 'retention.applied',
        target: { type: 'shift_trails', id: null },
        after: { before, deleted: trails.length },
      });
    }
    if (files.length > 0) {
      await this.audit.record(tx, tenantId, SYSTEM_ACTOR, {
        action: 'retention.applied',
        target: { type: 'location_archive', id: null },
        after: { before, expired: files.length },
      });
    }
    return { trails: trails.length, expired: files.length };
  }
}

interface ArchivedPoint {
  id: string;
  shiftId: string;
  userId: string;
  capturedAt: Date;
  receivedAt: Date;
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  source: string;
  battery: number | null;
}

/** The archive's columns (decision D69); readers find them by name. */
function parquetFile(rows: ArchivedPoint[]): ArrayBuffer {
  const column = <K extends keyof ArchivedPoint>(key: K) => rows.map((row) => row[key]);
  return parquetWriteBuffer({
    columnData: [
      { name: 'id', data: column('id'), type: 'UUID', nullable: false },
      { name: 'shift_id', data: column('shiftId'), type: 'UUID', nullable: false },
      { name: 'user_id', data: column('userId'), type: 'UUID', nullable: false },
      { name: 'captured_at', data: column('capturedAt'), type: 'TIMESTAMP', nullable: false },
      { name: 'received_at', data: column('receivedAt'), type: 'TIMESTAMP', nullable: false },
      { name: 'latitude', data: column('lat'), type: 'DOUBLE', nullable: false },
      { name: 'longitude', data: column('lng'), type: 'DOUBLE', nullable: false },
      { name: 'accuracy_m', data: column('accuracy'), type: 'FLOAT', nullable: false },
      { name: 'speed_mps', data: column('speed'), type: 'FLOAT' },
      { name: 'source', data: column('source'), type: 'STRING', nullable: false },
      { name: 'battery', data: column('battery'), type: 'INT32' },
    ],
  });
}
