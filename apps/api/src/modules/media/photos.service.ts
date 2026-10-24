import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { formatDateTime, translate } from '@thelamp/i18n';
import {
  AppError,
  type ConfirmMediaBody,
  DHASH_HEIGHT,
  DHASH_WIDTH,
  differenceHash,
  distanceMeters,
  DUPLICATE_DISTANCE,
  DUPLICATE_WINDOW_DAYS,
  isJpeg,
  type MediaResult,
  type MediaUrlResult,
  type MediaVariant,
  PHOTO_KINDS,
  type PhotoKind,
  photoKey,
  photoRetentionClass,
  type PresignMediaBody,
  type GeoPoint,
  type PresignMediaResult,
  newId,
  type Signature,
} from '@thelamp/shared';
import { and, asc, eq, gte, inArray, like, ne, sql } from 'drizzle-orm';
import sharp, { type Sharp } from 'sharp';
import type { Config } from '../../config';
import { media } from '../../db/schema/media';
import { AuditLog, SYSTEM_ACTOR } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { pointOf, pointSql } from '../../platform/geo';
import { ObjectStore } from '../../platform/object-store';
import { Outbox } from '../../platform/outbox';
import { Queues } from '../../platform/queues';
import { Schedules } from '../../platform/schedules';
import { CONFIG } from '../../platform/tokens';
import { notFound, outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { MediaUrls } from './media-urls';

/** How long an upload link lasts (spec 12.2). */
const UPLOAD_LINK_SECONDS = 10 * 60;
/** The thumbnail's long side, in pixels. */
const THUMBNAIL_PX = 320;
const JPEG_QUALITY = 70;
/** Photos expired in one transaction. */
const EXPIRE_BATCH = 200;

type Row = typeof media.$inferSelect;

const RESULT = {
  id: media.id,
  kind: media.kind,
  status: media.status,
  size: media.size,
  sha256: media.sha256,
  source: media.source,
  capturedAt: media.capturedAt,
  point: pointOf(media.point),
  accuracy: media.accuracy,
  duplicateOfId: media.duplicateOfId,
  rejectReason: media.rejectReason,
  createdAt: media.createdAt,
};

const isPhoto = (kind: string): kind is PhotoKind =>
  (PHOTO_KINDS as readonly string[]).includes(kind);

/** A photo that can't be used, and why; processing marks it rejected instead of retrying. */
class Unusable extends Error {}

/**
 * Photos (spec 12.2): the phone registers each one, uploads it straight to storage through a
 * presigned link that pins its bytes, and confirms it; the media worker checks it, hashes it,
 * looks for duplicates (BR-40), and writes a thumbnail and a stamped copy beside the untouched
 * original. Reads go through short-lived signed links.
 */
@Injectable()
export class PhotosService implements OnModuleInit {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly database: Database,
    private readonly objects: ObjectStore,
    private readonly urls: MediaUrls,
    private readonly queues: Queues,
    private readonly scopes: Scopes,
    private readonly people: People,
    private readonly settings: TenantConfigService,
    private readonly outbox: Outbox,
    private readonly schedules: Schedules,
    private readonly audit: AuditLog,
  ) {}

  onModuleInit(): void {
    this.queues.handle('media', 'media.process', (data) =>
      this.process(String(data.tenantId), String(data.mediaId)),
    );
    this.queues.handle('maintenance', 'media.retention', async (data) => {
      await this.expireEvidence(String(data.tenantId));
    });
    this.schedules.atTenantTime({
      name: 'media',
      at: '01:00',
      queue: 'maintenance',
      kind: 'media.retention',
    });
  }

  /**
   * Evidence retention (BR-41, decision D69): photos and signatures past the keeping time they
   * were captured under lose their files, the original and every derivative, and their rows are
   * marked deleted, so the records that show them say the photo was removed.
   */
  async expireEvidence(tenantId: string, now = new Date()): Promise<number> {
    let expired = 0;
    for (;;) {
      const done = await this.database.forTenant(tenantId, async (tx) => {
        const due = await tx
          .select({ id: media.id, objectKey: media.objectKey, derivatives: media.derivatives })
          .from(media)
          .where(
            and(
              eq(media.tenantId, tenantId),
              ne(media.status, 'deleted'),
              like(media.retentionClass, 'evidence-%'),
              sql`coalesce(${media.capturedAt}, ${media.createdAt}) < ${now.toISOString()}::timestamptz - make_interval(months => substring(${media.retentionClass} from '^evidence-([0-9]+)m$')::int)`,
            ),
          )
          .limit(EXPIRE_BATCH);
        for (const row of due) {
          for (const key of [row.objectKey, ...Object.values(row.derivatives)]) {
            await this.objects.delete(key);
          }
        }
        if (due.length > 0) {
          await tx
            .update(media)
            .set({ status: 'deleted' })
            .where(
              and(
                eq(media.tenantId, tenantId),
                inArray(
                  media.id,
                  due.map((row) => row.id),
                ),
              ),
            );
          await this.audit.record(tx, tenantId, SYSTEM_ACTOR, {
            action: 'retention.applied',
            target: { type: 'media', id: null },
            after: { class: 'evidence', deleted: due.length },
          });
        }
        return due.length;
      });
      expired += done;
      if (done < EXPIRE_BATCH) return expired;
    }
  }

  /** Step 2: registers a photo the phone made, and says where to upload it. */
  async presign(tx: TenantTx, access: Access, body: PresignMediaBody): Promise<PresignMediaResult> {
    const tenantId = access.tenantId;
    let [row] = await tx
      .select()
      .from(media)
      .where(and(eq(media.tenantId, tenantId), eq(media.id, body.id)));
    if (row) {
      const same =
        row.userId === access.userId &&
        row.kind === body.kind &&
        row.size === body.size &&
        row.sha256 === body.sha256;
      if (!same) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'This photo ID was already used for another file. Make a new one.',
        );
      }
    } else {
      const { evidencePhotoRetentionMonths } = await this.settings.settings(tx, tenantId);
      [row] = await tx
        .insert(media)
        .values({
          id: body.id,
          tenantId,
          userId: access.userId,
          kind: body.kind,
          objectKey: photoKey(tenantId, body.kind, body.id, 'original', new Date()),
          contentType: body.contentType,
          size: body.size,
          sha256: body.sha256,
          status: 'pending',
          retentionClass: photoRetentionClass(evidencePhotoRetentionMonths),
        })
        .returning();
    }
    // A retried registration whose bytes arrived already skips the upload.
    const there =
      row!.status !== 'pending' || (await this.objects.size(row!.objectKey)) === row!.size;
    if (there) return { id: row!.id, status: row!.status, upload: null };
    const put = await this.objects.presignPut(
      row!.objectKey,
      {
        contentType: body.contentType,
        size: body.size,
        sha256: body.sha256,
        tagging: `retention=${row!.retentionClass}`,
      },
      UPLOAD_LINK_SECONDS,
    );
    return {
      id: row!.id,
      status: row!.status,
      upload: {
        url: put.url,
        method: 'PUT',
        headers: put.headers,
        expiresAt: new Date(Date.now() + UPLOAD_LINK_SECONDS * 1000).toISOString(),
      },
    };
  }

  /** Step 3: the bytes are up. Processing follows on the media queue. */
  async confirm(
    tx: TenantTx,
    access: Access,
    id: string,
    body: ConfirmMediaBody,
  ): Promise<MediaResult> {
    const row = await this.own(tx, access, id, true);
    if (row.status === 'pending') {
      const size = await this.objects.size(row.objectKey);
      if (size === null) {
        throw new AppError(
          'MEDIA_NOT_READY',
          'The photo has not arrived yet. Upload it, then confirm.',
        );
      }
      await tx
        .update(media)
        .set({
          status: 'uploaded',
          source: body.source,
          capturedAt: new Date(body.capturedAt),
          ...(body.fix
            ? {
                point: pointSql(body.fix),
                accuracy: body.fix.accuracy,
                mocked: body.fix.mocked,
              }
            : {}),
          confirmedAt: new Date(),
        })
        .where(and(eq(media.tenantId, access.tenantId), eq(media.id, id)));
      this.database.afterCommit(tx, () =>
        this.queues.add(
          'media',
          'media.process',
          { tenantId: access.tenantId, mediaId: id },
          { jobId: `media.process.${id}` },
        ),
      );
    }
    return this.result(tx, access.tenantId, id);
  }

  /** Step 6: a link to one variant, for whoever took it and those whose scope reaches them. */
  async url(
    tx: TenantTx,
    access: Access,
    id: string,
    variant: MediaVariant,
  ): Promise<MediaUrlResult> {
    const [row] = await tx
      .select()
      .from(media)
      .where(and(eq(media.tenantId, access.tenantId), eq(media.id, id)));
    if (!row || !isPhoto(row.kind)) throw notFound();
    if (
      row.userId !== access.userId &&
      !(row.userId && (await this.scopes.reaches(tx, access, row.userId)))
    ) {
      throw outOfScope();
    }
    if (row.status === 'deleted') {
      throw new AppError('NOT_FOUND', 'This photo was removed when its keeping time ended.');
    }
    const key = variant === 'original' ? row.objectKey : row.derivatives[variant];
    const ready = variant === 'original' ? row.status !== 'pending' : row.status === 'processed';
    if (!ready || !key) {
      throw new AppError(
        'MEDIA_NOT_READY',
        'This photo is still being processed. Try again shortly.',
      );
    }
    return this.urls.read(key);
  }

  async result(tx: TenantTx, tenantId: string, id: string): Promise<MediaResult> {
    const [row] = await tx
      .select(RESULT)
      .from(media)
      .where(and(eq(media.tenantId, tenantId), eq(media.id, id)));
    if (!row || !isPhoto(row.kind)) throw notFound();
    return {
      ...row,
      kind: row.kind,
      capturedAt: row.capturedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Checks a photo before a record attaches it by ID (spec 12.2, step 5): the caller's own, of
   * the kind the record needs, and uploaded; one still on the phone is MEDIA_NOT_READY.
   */
  async attachable(tx: TenantTx, access: Access, id: string, kind: PhotoKind): Promise<void> {
    const row = await this.own(tx, access, id);
    if (row.kind !== kind) {
      throw new AppError('VALIDATION', `This photo is not a ${kind} photo.`, [
        { path: 'mediaId', issue: `Use a ${kind} photo` },
      ]);
    }
    if (row.status === 'rejected') {
      throw new AppError('VALIDATION', 'This photo could not be used.', [
        { path: 'mediaId', issue: 'Take the photo again' },
      ]);
    }
    if (row.status === 'pending') {
      throw new AppError('MEDIA_NOT_READY', 'The photo has not finished uploading.');
    }
  }

  /** Photos a record names, as BR-32 judges them, with what processing found so far. */
  async forRecord(tx: TenantTx, tenantId: string, ids: readonly string[]) {
    if (ids.length === 0) return [];
    return tx
      .select({
        id: media.id,
        userId: media.userId,
        kind: media.kind,
        status: media.status,
        ownerType: media.ownerType,
        ownerId: media.ownerId,
        capturedAt: media.capturedAt,
        point: pointOf(media.point),
        source: media.source,
        duplicateOfId: media.duplicateOfId,
      })
      .from(media)
      .where(and(eq(media.tenantId, tenantId), inArray(media.id, [...ids])))
      .for('update');
  }

  /**
   * The evidence photos each record holds, as a reviewer weighs them (M7): how each was taken,
   * when, how far from where its record was captured, and whether it repeats another.
   */
  async forReview(
    tx: TenantTx,
    tenantId: string,
    ownerType: string,
    owners: readonly { id: string; at: GeoPoint }[],
  ) {
    const found = new Map<
      string,
      {
        id: string;
        source: Row['source'];
        capturedAt: string | null;
        distanceM: number | null;
        duplicate: boolean;
      }[]
    >();
    if (owners.length === 0) return found;
    const places = new Map(owners.map((owner) => [owner.id, owner.at]));
    const rows = await tx
      .select({
        id: media.id,
        ownerId: media.ownerId,
        source: media.source,
        capturedAt: media.capturedAt,
        point: pointOf(media.point),
        duplicateOfId: media.duplicateOfId,
      })
      .from(media)
      .where(
        and(
          eq(media.tenantId, tenantId),
          eq(media.ownerType, ownerType),
          inArray(
            media.ownerId,
            owners.map((owner) => owner.id),
          ),
          eq(media.kind, 'evidence'),
        ),
      )
      .orderBy(asc(media.capturedAt), asc(media.id));
    for (const row of rows) {
      const at = places.get(row.ownerId!)!;
      const list = found.get(row.ownerId!) ?? [];
      list.push({
        id: row.id,
        source: row.source,
        capturedAt: row.capturedAt?.toISOString() ?? null,
        distanceM: row.point ? Math.round(distanceMeters(row.point, at)) : null,
        duplicate: row.duplicateOfId !== null,
      });
      found.set(row.ownerId!, list);
    }
    return found;
  }

  /**
   * Attaches photos to the record that names them (spec 12.2, step 5), in the transaction that
   * creates it. The caller has checked them first; one held elsewhere stays where it is.
   */
  /** The photos records of a type hold, by record: each one's kind and whether it repeats another. */
  async ownedBy(
    tx: TenantTx,
    tenantId: string,
    ownerType: string,
    ownerIds: readonly string[],
  ): Promise<{ id: string; ownerId: string; kind: string; duplicateOfId: string | null }[]> {
    if (ownerIds.length === 0) return [];
    const rows = await tx
      .select({
        id: media.id,
        ownerId: media.ownerId,
        kind: media.kind,
        duplicateOfId: media.duplicateOfId,
      })
      .from(media)
      .where(
        and(
          eq(media.tenantId, tenantId),
          eq(media.ownerType, ownerType),
          inArray(media.ownerId, [...ownerIds]),
          ne(media.status, 'deleted'),
        ),
      )
      .orderBy(asc(media.capturedAt), asc(media.id));
    return rows.map((row) => ({ ...row, ownerId: row.ownerId! }));
  }

  async attach(
    tx: TenantTx,
    tenantId: string,
    ids: readonly string[],
    owner: { type: string; id: string },
  ): Promise<void> {
    if (ids.length === 0) return;
    await tx
      .update(media)
      .set({ ownerType: owner.type, ownerId: owner.id })
      .where(
        and(
          eq(media.tenantId, tenantId),
          inArray(media.id, [...ids]),
          sql`(${media.ownerId} is null or ${media.ownerId} = ${owner.id})`,
        ),
      );
  }

  /**
   * Renders a signature drawn on the phone to a JPEG, black strokes on white, and keeps it as a
   * `signature` item made by the server (`generated`), owned by its record. Returns its ID.
   */
  async storeSignature(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    signature: Signature,
    owner: { type: string; id: string; at: Date },
  ): Promise<string> {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${signature.width}" height="${signature.height}" viewBox="0 0 ${signature.width} ${signature.height}">` +
        `<rect width="100%" height="100%" fill="#ffffff"/>` +
        signature.strokes
          .map(
            (stroke) =>
              `<path d="${stroke}" fill="none" stroke="#000000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
          )
          .join('') +
        `</svg>`,
    );
    const bytes = new Uint8Array(await sharp(svg).flatten().jpeg({ quality: 85 }).toBuffer());
    const id = newId();
    const { evidencePhotoRetentionMonths } = await this.settings.settings(tx, tenantId);
    const objectKey = photoKey(tenantId, 'signature', id, 'original', owner.at);
    await this.objects.put(objectKey, bytes, 'image/jpeg');
    await tx.insert(media).values({
      id,
      tenantId,
      userId,
      kind: 'signature',
      objectKey,
      contentType: 'image/jpeg',
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      status: 'processed',
      ownerType: owner.type,
      ownerId: owner.id,
      retentionClass: photoRetentionClass(evidencePhotoRetentionMonths),
      source: 'generated',
      capturedAt: owner.at,
      confirmedAt: new Date(),
      processedAt: new Date(),
    });
    return id;
  }

  /** The caller's own photo; another person's is out of scope, another tenant's not found. */
  private async own(tx: TenantTx, access: Access, id: string, lock = false): Promise<Row> {
    const query = tx
      .select()
      .from(media)
      .where(and(eq(media.tenantId, access.tenantId), eq(media.id, id)));
    const [row] = lock ? await query.for('update') : await query;
    if (!row || !isPhoto(row.kind)) throw notFound();
    if (row.userId !== access.userId) throw outOfScope();
    return row;
  }

  // The media worker (step 4).

  /**
   * Checks an uploaded photo against its checksum and JPEG signature, hashes it, writes its
   * thumbnail and stamped copy, and flags it when it repeats another (BR-40). Running it again
   * changes nothing; a photo that can't be used is rejected, never retried.
   */
  async process(tenantId: string, id: string): Promise<void> {
    const row = await this.database.forTenant(tenantId, async (tx) => {
      const [found] = await tx
        .select({ row: media, point: pointOf(media.point) })
        .from(media)
        .where(and(eq(media.tenantId, tenantId), eq(media.id, id)));
      return found;
    });
    if (!row || row.row.status !== 'uploaded' || !isPhoto(row.row.kind)) return;
    const photo = row.row;
    try {
      const bytes = await this.objects.get(photo.objectKey);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== photo.sha256) throw new Unusable("The bytes don't match their checksum.");
      if (!isJpeg(bytes)) throw new Unusable('This is not a JPEG photo.');
      const image = sharp(bytes, { failOn: 'error' }).rotate();
      const dhash = differenceHash(
        new Uint8Array(
          await image
            .clone()
            .greyscale()
            .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: 'fill' })
            .raw()
            .toBuffer(),
        ),
      ).padStart(16, '0');
      const thumbnail = await image
        .clone()
        .resize(THUMBNAIL_PX, THUMBNAIL_PX, { fit: 'inside' })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
      const stamped = await this.stamp(tenantId, image.clone(), photo, row.point);
      const at = photo.createdAt;
      const kind = photo.kind as PhotoKind;
      const derivatives = {
        thumbnail: photoKey(tenantId, kind, id, 'thumbnail', at),
        stamped: photoKey(tenantId, kind, id, 'stamped', at),
      };
      await this.objects.put(derivatives.thumbnail, new Uint8Array(thumbnail), 'image/jpeg');
      await this.objects.put(derivatives.stamped, new Uint8Array(stamped), 'image/jpeg');
      await this.database.forTenant(tenantId, async (tx) => {
        const duplicateOfId = await this.duplicateOf(tx, photo, dhash);
        const [done] = await tx
          .update(media)
          .set({ status: 'processed', dhash, duplicateOfId, derivatives, processedAt: new Date() })
          .where(and(eq(media.tenantId, tenantId), eq(media.id, id), eq(media.status, 'uploaded')))
          .returning({ ownerType: media.ownerType, ownerId: media.ownerId });
        // A record that took the photo before processing learns what it found.
        if (done) {
          await this.outbox.publish(tx, tenantId, 'media.processed', id, {
            mediaId: id,
            ownerType: done.ownerType,
            ownerId: done.ownerId,
            duplicateOfId,
          });
        }
      });
    } catch (error) {
      const reason =
        error instanceof Unusable
          ? error.message
          : /unsupported image|corrupt|premature|vips/i.test((error as Error).message)
            ? 'The photo could not be read.'
            : null;
      // Anything else, such as storage being away, is retried by the queue.
      if (!reason) throw error;
      this.logger.warn(`Photo ${id} rejected: ${reason}`);
      await this.database.forTenant(tenantId, (tx) =>
        tx
          .update(media)
          .set({ status: 'rejected', rejectReason: reason, processedAt: new Date() })
          .where(and(eq(media.tenantId, tenantId), eq(media.id, id), eq(media.status, 'uploaded'))),
      );
    }
  }

  /**
   * BR-40: the earliest other photo in the tenant with the same bytes, or else of the same kind
   * from the last 90 days with a difference hash within 4 bits.
   */
  private async duplicateOf(tx: TenantTx, photo: Row, dhash: string): Promise<string | null> {
    const others = and(
      eq(media.tenantId, photo.tenantId),
      ne(media.id, photo.id),
      inArray(media.status, ['uploaded', 'processed']),
    );
    const [same] = await tx
      .select({ id: media.id })
      .from(media)
      .where(and(others, eq(media.sha256, photo.sha256)))
      .orderBy(asc(media.createdAt))
      .limit(1);
    if (same) return same.id;
    const since = new Date(
      (photo.capturedAt ?? photo.createdAt).getTime() - DUPLICATE_WINDOW_DAYS * 86_400_000,
    );
    const [near] = await tx
      .select({ id: media.id })
      .from(media)
      .where(
        and(
          others,
          eq(media.kind, photo.kind),
          gte(media.capturedAt, since),
          sql`${media.dhash} is not null`,
          sql`bit_count(('x' || ${media.dhash})::bit(64) # ('x' || ${dhash})::bit(64)) <= ${DUPLICATE_DISTANCE}`,
        ),
      )
      .orderBy(asc(media.createdAt))
      .limit(1);
    return near?.id ?? null;
  }

  /**
   * The stamped copy: the photo with a footer beneath it, never over it, naming the product, who
   * took it, when on the tenant's clock, where and how surely, and how (spec 12.2).
   */
  private async stamp(
    tenantId: string,
    image: Sharp,
    photo: Row,
    point: { lat: number; lng: number } | null,
  ): Promise<Buffer> {
    const { settings, person } = await this.database.forTenant(tenantId, async (tx) => ({
      settings: await this.settings.settings(tx, tenantId),
      person: photo.userId
        ? (await this.people.facts(tx, tenantId, [photo.userId])).get(photo.userId)
        : undefined,
    }));
    const locale = settings.languages[0] ?? 'en';
    const taken = photo.capturedAt ?? photo.createdAt;
    const where = point
      ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)} ±${Math.round(photo.accuracy ?? 0)} m`
      : translate('stamp.no_fix', { locale });
    const lines = [
      [this.config.PRODUCT_NAME, person ? `${person.name} (${person.code})` : null]
        .filter(Boolean)
        .join(' · '),
      [
        formatDateTime(taken, { locale, timeZone: settings.timezone }),
        where,
        translate(`stamp.source_${photo.source ?? 'camera'}`, { locale }),
      ].join(' · '),
    ];
    const { width = 1600 } = await image.metadata();
    const size = Math.max(14, Math.round(width / 50));
    const height = Math.round(size * 3.4);
    const escape = (text: string) =>
      text.replace(
        /[&<>"]/g,
        (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!,
      );
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<rect width="100%" height="100%" fill="#121110"/>` +
        lines
          .map(
            (line, index) =>
              `<text x="${size}" y="${Math.round(size * (1.4 + index * 1.4))}" font-family="Noto Sans, sans-serif" font-size="${size}" fill="#f7f6f3">${escape(line)}</text>`,
          )
          .join('') +
        `</svg>`,
    );
    return image
      .extend({ bottom: height, background: '#121110' })
      .composite([{ input: svg, gravity: 'south' }])
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  }
}
