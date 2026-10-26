import { z } from 'zod';
import type { TenantPermission } from '../access';
import type { SwitchableModule } from '../modules';
import { AUDIT_ACTIONS, AUDIT_ACTOR_KINDS } from './audit';
import { Key } from './config';
import { Period } from './planning';

/**
 * Reports and exports (module M18, decision D62). A report is read a page at a time with
 * `GET /v1/reports/{key}`; an export takes the same key and filters, so the file always holds
 * what the screen shows.
 */

/** The standard reports of M18 (decisions D62 and D86). */
export const REPORT_KEYS = [
  'activity_log',
  'attendance_register',
  'target_achievement',
  'leave_register',
  'expense_register',
  'visit_compliance',
  'coverage_frequency',
  'location_summary',
  'orders_register',
  'account_statement',
  'audit_log',
] as const;
export const ReportKey = z.enum(REPORT_KEYS).meta({ id: 'ReportKey' });

/** Reports that belong to a switchable module rather than Core (spec 5.13): off, they close. */
export const REPORT_MODULE: Partial<Record<(typeof REPORT_KEYS)[number], SwitchableModule>> = {
  attendance_register: 'leave_attendance',
  leave_register: 'leave_attendance',
  expense_register: 'expenses',
  orders_register: 'orders',
  account_statement: 'account_finance',
};

/** Reports that need a permission beyond `report.view`, as their records do elsewhere. */
export const REPORT_PERMISSION: Partial<Record<(typeof REPORT_KEYS)[number], TenantPermission>> = {
  orders_register: 'order.view',
  account_statement: 'finance.view',
  audit_log: 'audit.view',
};

/** What every report can be narrowed by (M18), within the caller's scope. */
export const ReportFilters = z.strictObject({
  period: Period,
  /** A manager: them and everyone below them in the reporting tree. */
  managerId: z.uuid().optional(),
  /** People attached at or below this territory. */
  territoryId: z.uuid().optional(),
  userId: z.uuid().optional(),
  /** The activity log only: submissions at accounts of this type. */
  accountType: Key.optional(),
  /** The activity log only: one form, whose fields become columns. */
  form: Key.optional(),
  /** The audit log only: one action, and who acted (decision D95). */
  auditAction: z.enum(AUDIT_ACTIONS).optional(),
  auditActorKind: z.enum(AUDIT_ACTOR_KINDS).optional(),
});

/** `GET /v1/reports/{key}`: the filters, and a page. */
export const ReportQuery = ReportFilters.extend({
  /** The language of the headings and of coded values such as a geofence result. */
  locale: z.enum(['en', 'hi']).default('en'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ReportKeyParam = z.strictObject({ key: ReportKey });

/** How a column's values read: numbers stay numbers in a spreadsheet. */
export const REPORT_COLUMN_KINDS = [
  'text',
  'number',
  'decimal',
  'percent',
  'date',
  'datetime',
  'boolean',
] as const;
export const ReportColumnKind = z.enum(REPORT_COLUMN_KINDS);

export const ReportColumn = z.object({
  key: z.string(),
  /** The heading in the language asked for, with the tenant's terms in it. */
  label: z.string(),
  kind: ReportColumnKind,
});

/**
 * A cell: dates and moments as ISO text, decimals as text so nothing is rounded, and coded values
 * already in words.
 */
export const ReportCell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ReportPage = z
  .object({
    report: ReportKey,
    period: Period,
    columns: z.array(ReportColumn),
    rows: z.array(z.record(z.string(), ReportCell)),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: 'ReportPage' });

export const EXPORT_FORMATS = ['xlsx', 'csv'] as const;
export const ExportFormat = z.enum(EXPORT_FORMATS);

export const EXPORT_STATUSES = ['queued', 'running', 'ready', 'failed', 'expired'] as const;
export const ExportStatus = z.enum(EXPORT_STATUSES);

/** `POST /v1/exports`: which report, narrowed how, as which file, with headings in which language. */
export const CreateExportBody = z.strictObject({
  id: z.uuid(),
  report: ReportKey,
  filters: ReportFilters,
  format: ExportFormat,
  locale: z.enum(['en', 'hi']).default('en'),
});

export const ExportResult = z
  .object({
    id: z.uuid(),
    report: ReportKey,
    filters: ReportFilters,
    format: ExportFormat,
    status: ExportStatus,
    rows: z.int().nullable(),
    fileName: z.string().nullable(),
    createdAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    /** The file is kept until then (M18: seven days). */
    expiresAt: z.iso.datetime().nullable(),
    /** A short-lived link to the file, while it is ready. */
    download: z.object({ url: z.string(), expiresAt: z.iso.datetime() }).nullable(),
  })
  .meta({ id: 'ExportResult' });

export const ExportIdParam = z.strictObject({ id: z.uuid() });

export const ExportListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const ExportListResult = z.object({ items: z.array(ExportResult) });

export type ReportKey = z.infer<typeof ReportKey>;
export type ReportFilters = z.output<typeof ReportFilters>;
export type ReportQuery = z.output<typeof ReportQuery>;
export type ReportColumn = z.infer<typeof ReportColumn>;
export type ReportColumnKind = z.infer<typeof ReportColumnKind>;
export type ReportCell = z.infer<typeof ReportCell>;
export type ReportPage = z.infer<typeof ReportPage>;
export type ExportFormat = z.infer<typeof ExportFormat>;
export type ExportStatus = z.infer<typeof ExportStatus>;
export type CreateExportBody = z.output<typeof CreateExportBody>;
export type ExportResult = z.infer<typeof ExportResult>;
export type ExportListQuery = z.output<typeof ExportListQuery>;
export type ExportListResult = z.infer<typeof ExportListResult>;
