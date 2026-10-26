import { z } from 'zod';

/**
 * A tenant's data export (module M21, spec 13.3, decision D95): every table and file the tenant
 * owns, as one ZIP archive. `manifest.json` lists each entry with its SHA-256, and `manifest.sig`
 * is an Ed25519 signature over the manifest's bytes, so anyone with the cell's public key can tell
 * that nothing was changed, added or left out.
 */

export const ARCHIVE_FORMAT = 'tenant-archive';
export const ARCHIVE_VERSION = 1;
export const ARCHIVE_MANIFEST = 'manifest.json';
export const ARCHIVE_SIGNATURE = 'manifest.sig';

/** How long an archive is kept, and how long each download link lasts. */
export const DATA_EXPORT_KEEP_DAYS = 7;
export const DATA_EXPORT_LINK_HOURS = 24;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const ArchiveManifest = z.strictObject({
  format: z.literal(ARCHIVE_FORMAT),
  version: z.literal(ARCHIVE_VERSION),
  product: z.string(),
  tenant: z.strictObject({ id: z.uuid(), name: z.string() }),
  cell: z.string(),
  /** The last database migration the rows follow. */
  schema: z.string(),
  createdAt: z.iso.datetime(),
  /** Which signing key: the first 16 hexadecimal digits of the public key's SHA-256. */
  keyId: z.string().regex(/^[0-9a-f]{16}$/),
  /** Each table as JSON lines, one row an object keyed by column. */
  tables: z.array(
    z.strictObject({
      name: z.string(),
      path: z.string(),
      rows: z.int().min(0),
      bytes: z.int().min(0),
      sha256,
    }),
  ),
  /** Each stored file, as it was uploaded. */
  media: z.array(
    z.strictObject({
      id: z.uuid(),
      path: z.string(),
      kind: z.string(),
      contentType: z.string(),
      fileName: z.string().nullable(),
      bytes: z.int().min(0),
      sha256,
    }),
  ),
  /** What is left out on purpose: internal tables, and secrets as `table.column`. */
  omitted: z.strictObject({ tables: z.array(z.string()), columns: z.array(z.string()) }),
});
export type ArchiveManifest = z.infer<typeof ArchiveManifest>;

/** The key ID of an Ed25519 public key, from its DER bytes' SHA-256 in hexadecimal. */
export function archiveKeyId(publicKeySha256Hex: string): string {
  return publicKeySha256Hex.slice(0, 16);
}

/** When an archive finished at `finishedAt` is removed. */
export function dataExportExpiry(finishedAt: Date): Date {
  return new Date(finishedAt.getTime() + DATA_EXPORT_KEEP_DAYS * 86_400_000);
}
