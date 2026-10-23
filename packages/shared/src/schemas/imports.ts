import { z } from 'zod';
import { Key, LocalizedText } from './config';

/**
 * Imports (module M19). Each module adds its target as its import arrives; accounts import one
 * type at a time, as `accounts:<type key>` (Appendix B.2).
 */

export const IMPORT_TARGETS = [
  'users',
  'territories',
  'items',
  'targets',
  'account_plans',
  'finance_snapshots',
  'ledger_entries',
] as const;
export const AccountsImportTarget = z.templateLiteral(['accounts:', Key]);
export const ImportTarget = z
  .union([z.enum(IMPORT_TARGETS), AccountsImportTarget])
  .meta({ id: 'ImportTarget' });

export const IMPORT_STATUSES = [
  'reading',
  'mapping',
  'validating',
  'ready',
  'invalid',
  'committing',
  'committed',
  'failed',
] as const;
export const ImportStatus = z.enum(IMPORT_STATUSES);

/** `POST /v1/imports?target=…&fileName=…`, with the file itself as the body. */
export const CreateImportQuery = z.strictObject({
  target: ImportTarget,
  fileName: z.string().trim().min(1).max(200),
});

/** A field the file's columns can fill. Custom fields carry their own label. */
export const ImportFieldInfo = z.object({
  key: z.string(),
  required: z.boolean(),
  label: LocalizedText.optional().meta({ description: "A custom field's label" }),
});

export const ImportProblem = z.object({
  /** The row's number in the file, counting from 1; null for the file as a whole. */
  row: z.int().nullable(),
  field: z.string().nullable(),
  issue: z.string(),
});

export const ImportPreviewRow = z.object({
  row: z.int(),
  values: z.record(z.string(), z.string()),
  problems: z.array(z.string()),
});

export const ImportResult = z
  .object({
    id: z.uuid(),
    target: ImportTarget,
    fileName: z.string(),
    status: ImportStatus,
    sheets: z.array(z.string()),
    sheet: z.string().nullable(),
    /** The header's row in the file, counting from 1. */
    headerRow: z.int().nullable(),
    headers: z.array(z.string()),
    /** Which field each header fills, by header; null leaves a column out. */
    mapping: z.record(z.string(), z.string().nullable()),
    fields: z.array(ImportFieldInfo),
    totalRows: z.int().nullable(),
    errorRows: z.int().nullable(),
    /** The first thousand problems. */
    errors: z.array(ImportProblem),
    /** The first 200 rows, as the import reads them. */
    preview: z.array(ImportPreviewRow),
    created: z.int().nullable(),
    updated: z.int().nullable(),
    createdBy: z.uuid(),
    createdAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Import' });

export const ImportSummary = ImportResult.pick({
  id: true,
  target: true,
  fileName: true,
  status: true,
  totalRows: true,
  errorRows: true,
  created: true,
  updated: true,
  createdBy: true,
  createdAt: true,
  finishedAt: true,
});

export const ImportListQuery = z.strictObject({
  target: ImportTarget.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
});

export const ImportListResult = z.object({
  items: z.array(ImportSummary),
  nextCursor: z.uuid().nullable(),
});

/**
 * `PUT /v1/imports/{id}/mapping`: another sheet to read, or the mapping to check the rows with,
 * optionally saved under a name for the next file like this one.
 */
export const UpdateImportMappingBody = z
  .strictObject({
    sheet: z.string().min(1).max(100).optional(),
    mapping: z.record(z.string().max(200), z.string().max(60).nullable()).optional(),
    saveAs: z.string().trim().min(1).max(60).optional(),
  })
  .refine(
    (body) => body.sheet !== undefined || body.mapping !== undefined,
    'Send a sheet or a mapping',
  );

export type ImportTarget = z.infer<typeof ImportTarget>;
export type ImportStatus = z.infer<typeof ImportStatus>;
export type CreateImportQuery = z.output<typeof CreateImportQuery>;
export type ImportFieldInfo = z.infer<typeof ImportFieldInfo>;
export type ImportProblem = z.infer<typeof ImportProblem>;
export type ImportPreviewRow = z.infer<typeof ImportPreviewRow>;
export type ImportResult = z.infer<typeof ImportResult>;
export type ImportSummary = z.infer<typeof ImportSummary>;
export type ImportListQuery = z.output<typeof ImportListQuery>;
export type ImportListResult = z.infer<typeof ImportListResult>;
export type UpdateImportMappingBody = z.output<typeof UpdateImportMappingBody>;
