import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { newId } from '@thelamp/shared';
import { and, asc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { media } from '../../db/schema/media';
import type { TenantTx } from '../../platform/database';
import { ObjectStore } from '../../platform/object-store';

type Kind = (typeof media.$inferInsert)['kind'];

export interface NewFile {
  kind: Kind;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  userId: string | null;
  ownerType: string;
  ownerId: string | null;
  /** Which retention rule removes it later, such as `import_file`. */
  retentionClass: string;
}

export interface StoredFile {
  id: string;
  sha256: string;
  size: number;
}

/**
 * Files (spec 12.2), owned by the media module. Storing writes the bytes to the object store
 * first and the row second, so a row never names a file that isn't there; a file whose row was
 * rolled back is left for the store's lifecycle rules.
 */
@Injectable()
export class MediaService {
  constructor(private readonly objects: ObjectStore) {}

  async store(tx: TenantTx, tenantId: string, file: NewFile): Promise<StoredFile> {
    const id = newId();
    const sha256 = createHash('sha256').update(file.bytes).digest('hex');
    const objectKey = `t/${tenantId}/${file.kind}/${id}`;
    await this.objects.put(objectKey, file.bytes, file.contentType);
    await tx.insert(media).values({
      id,
      tenantId,
      userId: file.userId,
      kind: file.kind,
      objectKey,
      fileName: file.fileName,
      contentType: file.contentType,
      size: file.bytes.byteLength,
      sha256,
      status: 'uploaded',
      ownerType: file.ownerType,
      ownerId: file.ownerId,
      retentionClass: file.retentionClass,
    });
    return { id, sha256, size: file.bytes.byteLength };
  }

  /**
   * Stores a file already on disk, whose size and SHA-256 the caller worked out while writing it,
   * without reading it into memory: a tenant's archive can be larger than the process should hold.
   */
  async storeFile(
    tx: TenantTx,
    tenantId: string,
    file: Omit<NewFile, 'bytes'> & { path: string; size: number; sha256: string },
  ): Promise<StoredFile> {
    const id = newId();
    const objectKey = `t/${tenantId}/${file.kind}/${id}`;
    await this.objects.putFile(objectKey, file.path, file.contentType);
    await tx.insert(media).values({
      id,
      tenantId,
      userId: file.userId,
      kind: file.kind,
      objectKey,
      fileName: file.fileName,
      contentType: file.contentType,
      size: file.size,
      sha256: file.sha256,
      status: 'uploaded',
      ownerType: file.ownerType,
      ownerId: file.ownerId,
      retentionClass: file.retentionClass,
    });
    return { id, sha256: file.sha256, size: file.size };
  }

  /** A stored file's bytes, with how it was stored. */
  /** Bytes the tenant keeps in storage now, derivatives included; deleted files count no more. */
  async storedBytes(tx: TenantTx, tenantId: string): Promise<number> {
    const [row] = await tx
      .select({ bytes: sql<string>`coalesce(sum(${media.size}), 0)::text` })
      .from(media)
      .where(and(eq(media.tenantId, tenantId), ne(media.status, 'deleted')));
    return Number(row?.bytes ?? 0);
  }

  async read(tx: TenantTx, tenantId: string, id: string) {
    const [row] = await tx
      .select({
        objectKey: media.objectKey,
        contentType: media.contentType,
        fileName: media.fileName,
      })
      .from(media)
      .where(and(eq(media.tenantId, tenantId), eq(media.id, id)));
    if (!row) throw new Error(`There is no file ${id}.`);
    return { ...row, bytes: await this.objects.get(row.objectKey) };
  }

  /**
   * The files a tenant's archive carries (decision D95): every one stored and kept, but exports,
   * which are copies of what the archive holds already.
   */
  async forArchive(tx: TenantTx, tenantId: string) {
    return tx
      .select({
        id: media.id,
        kind: media.kind,
        contentType: media.contentType,
        fileName: media.fileName,
        derivatives: media.derivatives,
      })
      .from(media)
      .where(
        and(
          eq(media.tenantId, tenantId),
          inArray(media.status, ['uploaded', 'processed']),
          notInArray(media.kind, ['export_file', 'tenant_export']),
        ),
      )
      .orderBy(asc(media.id));
  }

  /** A stored file's bytes, or one derived copy's, such as a thumbnail, by its variant. */
  async variantBytes(
    tx: TenantTx,
    tenantId: string,
    id: string,
    variant: string | null,
  ): Promise<Uint8Array> {
    const [row] = await tx
      .select({ objectKey: media.objectKey, derivatives: media.derivatives })
      .from(media)
      .where(and(eq(media.tenantId, tenantId), eq(media.id, id)));
    const key = variant ? row?.derivatives[variant] : row?.objectKey;
    if (!key) throw new Error(`There is no file ${id}${variant ? ` ${variant}` : ''}.`);
    return this.objects.get(key);
  }

  /**
   * Puts a moved tenant's file back where its row says it lives (decision D95), unless the store
   * holds it already, as when both cells share a bucket.
   */
  async restore(
    tx: TenantTx,
    tenantId: string,
    id: string,
    variant: string | null,
    bytes: Uint8Array,
  ): Promise<void> {
    const [row] = await tx
      .select({
        objectKey: media.objectKey,
        derivatives: media.derivatives,
        contentType: media.contentType,
      })
      .from(media)
      .where(and(eq(media.tenantId, tenantId), eq(media.id, id)));
    const key = variant ? row?.derivatives[variant] : row?.objectKey;
    if (!row || !key) throw new Error(`The archive has a file ${id} its rows don't name.`);
    if ((await this.objects.size(key)) === bytes.byteLength) return;
    await this.objects.put(key, bytes, variant ? 'image/jpeg' : row.contentType);
  }

  /**
   * Removes every object a tenant's files are kept under, originals and derived copies, as a
   * purge of the tenant does (decision D95). The rows go with the rest of the tenant's.
   */
  async removeAllObjects(tx: TenantTx, tenantId: string): Promise<void> {
    const rows = await tx
      .select({ objectKey: media.objectKey, derivatives: media.derivatives })
      .from(media)
      .where(and(eq(media.tenantId, tenantId), ne(media.status, 'deleted')));
    for (const row of rows) {
      for (const key of [row.objectKey, ...Object.values(row.derivatives)]) {
        await this.objects.delete(key);
      }
    }
  }

  /** Where a stored file is in the object store, to link to it; null for nobody's. */
  async objectKey(tx: TenantTx, tenantId: string, id: string): Promise<string | null> {
    const [row] = await tx
      .select({ objectKey: media.objectKey })
      .from(media)
      .where(and(eq(media.tenantId, tenantId), eq(media.id, id), ne(media.status, 'deleted')));
    return row?.objectKey ?? null;
  }

  /**
   * Removes a file whose keeping time is over (retention, spec 10.3): the object and any
   * derivatives go, and the row stays, marked deleted, so what referred to it still reads.
   */
  async expire(tx: TenantTx, tenantId: string, id: string): Promise<void> {
    const [row] = await tx
      .select({ objectKey: media.objectKey, derivatives: media.derivatives })
      .from(media)
      .where(and(eq(media.tenantId, tenantId), eq(media.id, id), ne(media.status, 'deleted')));
    if (!row) return;
    for (const key of [row.objectKey, ...Object.values(row.derivatives)]) {
      await this.objects.delete(key);
    }
    await tx
      .update(media)
      .set({ status: 'deleted' })
      .where(and(eq(media.tenantId, tenantId), eq(media.id, id)));
  }
}
