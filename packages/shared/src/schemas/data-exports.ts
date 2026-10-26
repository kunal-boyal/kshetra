import { z } from 'zod';

/** Data exports (module M21, decision D95), as tenant admins ask for and download them. */

/** `POST /v1/data-exports`: the export's own ID, so a retried request asks once. */
export const CreateDataExportBody = z
  .strictObject({ id: z.uuid() })
  .meta({ id: 'CreateDataExportBody' });

export const DataExportStatus = z.enum(['queued', 'running', 'ready', 'failed', 'expired']);

export const DataExportResult = z
  .object({
    id: z.uuid(),
    status: DataExportStatus,
    requestedBy: z.object({ id: z.uuid().nullable(), name: z.string() }),
    fileName: z.string().nullable(),
    /** The archive's size in bytes, its SHA-256, and what it holds, once ready. */
    bytes: z.int().nullable(),
    sha256: z.string().nullable(),
    tables: z.int().nullable(),
    rows: z.int().nullable(),
    files: z.int().nullable(),
    keyId: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime().nullable(),
    /** A link to the archive, only when one export is read and its file is still kept. */
    download: z.object({ url: z.string(), expiresAt: z.iso.datetime() }).nullable(),
  })
  .meta({ id: 'DataExport' });

export const DataExportList = z.object({ items: z.array(DataExportResult) });

/** The key archives are signed with, so their signatures can be checked. */
export const ArchiveSigningKey = z
  .object({ keyId: z.string(), algorithm: z.literal('Ed25519'), publicKey: z.string() })
  .meta({ id: 'ArchiveSigningKey' });

export type CreateDataExportBody = z.output<typeof CreateDataExportBody>;
export type DataExportResult = z.infer<typeof DataExportResult>;
export type ArchiveSigningKey = z.infer<typeof ArchiveSigningKey>;
