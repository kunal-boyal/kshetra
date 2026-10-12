import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { newId } from '@kshetra/shared';
import { and, eq } from 'drizzle-orm';
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

  /** A stored file's bytes, with how it was stored. */
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
}
