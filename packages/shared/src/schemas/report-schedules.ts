import { z } from 'zod';
import { SCHEDULE_FREQUENCIES, SCHEDULE_RECIPIENTS_MOST } from '../report-schedules';
import { Period } from './planning';
import {
  ExportFormat,
  ExportReport,
  ExportStatus,
  REPORT_FOR_ONE_PERSON,
  ReportFilters,
} from './reports';
import { TimeOfDay } from './tenant-config';

/**
 * Scheduled reports (M18, BR-52, decision D122): a report, or every report, sent weekly or monthly
 * to chosen people, each as they may see it, through a link to an export of their own.
 */

const Person = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

/** A schedule's filters: a report's, without the month, which each send works out (BR-52). */
export const ScheduleFilters = ReportFilters.omit({ period: true });

export const SCHEDULE_STATUSES = ['active', 'paused'] as const;

/**
 * Why a schedule is paused: its owner paused it, or its owner may no longer schedule reports, so
 * it stopped by itself until they may again and resume it.
 */
export const SCHEDULE_PAUSE_REASONS = ['by_owner', 'owner_access'] as const;

const ScheduleFields = {
  report: ExportReport,
  filters: ScheduleFilters,
  format: ExportFormat,
  locale: z.enum(['en', 'hi']),
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  /** ISO weekday, 1 (Monday) to 7 (Sunday), for weekly; null for monthly, which sends on the 1st. */
  weekday: z.int().min(1).max(7).nullable(),
  at: TimeOfDay,
  recipients: z.array(z.uuid()).min(1).max(SCHEDULE_RECIPIENTS_MOST),
};

type Shape = {
  report?: z.output<typeof ExportReport>;
  filters?: z.output<typeof ScheduleFilters>;
  format?: z.output<typeof ExportFormat>;
  frequency?: (typeof SCHEDULE_FREQUENCIES)[number];
  weekday?: number | null;
  recipients?: string[];
};

/** BR-52's shape: a weekday for weekly only, every report as xlsx, one person where a report needs it. */
function checkShape(body: Shape, ctx: z.RefinementCtx) {
  if (body.frequency !== undefined && body.weekday !== undefined) {
    if (body.frequency === 'weekly' && body.weekday === null) {
      ctx.addIssue({ code: 'custom', path: ['weekday'], message: 'Choose a day of the week' });
    }
    if (body.frequency === 'monthly' && body.weekday !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['weekday'],
        message: 'A monthly report goes on the 1st',
      });
    }
  }
  if (body.report === 'workbook' && body.format !== undefined && body.format !== 'xlsx') {
    ctx.addIssue({
      code: 'custom',
      path: ['format'],
      message: 'Every report comes as one Excel file',
    });
  }
  if (
    body.report !== undefined &&
    body.report !== 'workbook' &&
    REPORT_FOR_ONE_PERSON.includes(body.report) &&
    body.filters !== undefined &&
    !body.filters.userId
  ) {
    ctx.addIssue({ code: 'custom', path: ['filters', 'userId'], message: 'Choose one person' });
  }
  if (body.recipients && new Set(body.recipients).size !== body.recipients.length) {
    ctx.addIssue({ code: 'custom', path: ['recipients'], message: 'Name each person once' });
  }
}

/** `POST /v1/report-schedules`. */
export const CreateReportScheduleBody = z
  .strictObject({ id: z.uuid(), ...ScheduleFields, locale: ScheduleFields.locale.default('en') })
  .superRefine(checkShape);

/**
 * `PUT /v1/report-schedules/{id}`: what changes, all together, and whether it runs. A schedule
 * keeps its report; another report is another schedule.
 */
export const UpdateReportScheduleBody = z
  .strictObject({
    filters: ScheduleFields.filters.optional(),
    format: ScheduleFields.format.optional(),
    locale: ScheduleFields.locale.optional(),
    frequency: ScheduleFields.frequency.optional(),
    weekday: ScheduleFields.weekday.optional(),
    at: ScheduleFields.at.optional(),
    recipients: ScheduleFields.recipients.optional(),
    status: z.enum(SCHEDULE_STATUSES).optional(),
  })
  .superRefine(checkShape);

export const ReportScheduleResult = z
  .object({
    id: z.uuid(),
    owner: Person,
    report: ExportReport,
    filters: ScheduleFilters,
    format: ExportFormat,
    locale: z.enum(['en', 'hi']),
    frequency: z.enum(SCHEDULE_FREQUENCIES),
    weekday: z.int().nullable(),
    at: z.string(),
    status: z.enum(SCHEDULE_STATUSES),
    pausedReason: z.enum(SCHEDULE_PAUSE_REASONS).nullable(),
    /** Who it sends to; to a recipient reading it, only themselves. */
    recipients: z.array(Person),
    /** The next send's date on the organisation's clock, while it runs. */
    nextSend: z.iso.date().nullable(),
    createdAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'ReportScheduleResult' });

export const ReportScheduleRun = z.object({
  id: z.uuid(),
  sendDate: z.iso.date(),
  period: Period,
  createdAt: z.iso.datetime(),
  /** Each recipient's export: what it holds as they may see it, or why it failed. */
  exports: z.array(
    z.object({
      user: Person,
      status: ExportStatus,
      rows: z.int().nullable(),
      error: z.string().nullable(),
    }),
  ),
});

export const ReportScheduleDetail = ReportScheduleResult.extend({
  /** The latest sends, newest first. */
  runs: z.array(ReportScheduleRun),
}).meta({ id: 'ReportScheduleDetail' });

export const ReportScheduleIdParam = z.strictObject({ id: z.uuid() });

/** `GET /v1/report-schedules`: the caller's own schedules, or (`for=me`) those sent to them. */
export const ReportScheduleListQuery = z.strictObject({
  for: z.enum(['owner', 'me']).default('owner'),
});

export const ReportScheduleListResult = z.object({ items: z.array(ReportScheduleResult) });

export type ScheduleFilters = z.output<typeof ScheduleFilters>;
export type CreateReportScheduleBody = z.output<typeof CreateReportScheduleBody>;
export type UpdateReportScheduleBody = z.output<typeof UpdateReportScheduleBody>;
export type ReportScheduleResult = z.infer<typeof ReportScheduleResult>;
export type ReportScheduleRun = z.infer<typeof ReportScheduleRun>;
export type ReportScheduleDetail = z.infer<typeof ReportScheduleDetail>;
export type ReportScheduleListQuery = z.output<typeof ReportScheduleListQuery>;
export type ReportScheduleListResult = z.infer<typeof ReportScheduleListResult>;
