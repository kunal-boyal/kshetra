import {
  EXPORT_STATUSES,
  type ReportFilters,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_PAUSE_REASONS,
  SCHEDULE_STATUSES,
  type ScheduleFilters,
} from '@thelamp/shared';
import { sql } from 'drizzle-orm';
import {
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cell, changeColumns, isolation } from './common';
import { users } from './iam';
import { media } from './media';

export const exportStatus = cell.enum('export_status', EXPORT_STATUSES);
export const scheduleFrequency = cell.enum('schedule_frequency', SCHEDULE_FREQUENCIES);
export const scheduleStatus = cell.enum('schedule_status', SCHEDULE_STATUSES);
export const schedulePauseReason = cell.enum('schedule_pause_reason', SCHEDULE_PAUSE_REASONS);

/**
 * Scheduled reports (M18, decision D122): a report, or every report, sent weekly or monthly. Each
 * send makes an export for each recipient, as they may see it.
 */
export const reportSchedules = cell
  .table(
    'report_schedules',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      ownerId: uuid('owner_id').notNull(),
      report: text('report').notNull(),
      filters: jsonb('filters').$type<ScheduleFilters>().notNull(),
      format: text('format').notNull(),
      locale: text('locale').notNull(),
      frequency: scheduleFrequency('frequency').notNull(),
      weekday: smallint('weekday'),
      at: text('at').notNull(),
      status: scheduleStatus('status').notNull().default('active'),
      pausedReason: schedulePauseReason('paused_reason'),
      /** When it last started or resumed: only send moments after it count (BR-52). */
      activeFrom: timestamp('active_from', { withTimezone: true }).notNull(),
      endedAt: timestamp('ended_at', { withTimezone: true }),
      ...changeColumns(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('report_schedules_tenant_owner').on(table.tenantId, table.ownerId),
      index('report_schedules_tenant_running')
        .on(table.tenantId)
        .where(sql`${table.status} = 'active' and ${table.endedAt} is null`),
      foreignKey({
        name: 'report_schedules_owner_fk',
        columns: [table.tenantId, table.ownerId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** Who a schedule sends to; leaving keeps the row with `left_at`. */
export const reportScheduleRecipients = cell
  .table(
    'report_schedule_recipients',
    {
      tenantId: uuid('tenant_id').notNull(),
      scheduleId: uuid('schedule_id').notNull(),
      userId: uuid('user_id').notNull(),
      addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
      leftAt: timestamp('left_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.scheduleId, table.userId] }),
      index('report_schedule_recipients_tenant_user').on(table.tenantId, table.userId),
      foreignKey({
        name: 'report_schedule_recipients_schedule_fk',
        columns: [table.tenantId, table.scheduleId],
        foreignColumns: [reportSchedules.tenantId, reportSchedules.id],
      }),
      foreignKey({
        name: 'report_schedule_recipients_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** One send of a schedule, keyed by its date on the tenant's clock, so it is made once. */
export const reportScheduleRuns = cell
  .table(
    'report_schedule_runs',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      scheduleId: uuid('schedule_id').notNull(),
      sendDate: date('send_date').notNull(),
      period: text('period').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      uniqueIndex('report_schedule_runs_tenant_schedule_date').on(
        table.tenantId,
        table.scheduleId,
        table.sendDate,
      ),
      foreignKey({
        name: 'report_schedule_runs_schedule_fk',
        columns: [table.tenantId, table.scheduleId],
        foreignColumns: [reportSchedules.tenantId, reportSchedules.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Exports (module M18, decision D62), owned by the reports module: one row per file asked for,
 * from the queue to the file, which is a `media` row kept for seven days.
 */
export const exportJobs = cell
  .table(
    'export_jobs',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      report: text('report').notNull(),
      filters: jsonb('filters').$type<ReportFilters>().notNull(),
      format: text('format').notNull(),
      locale: text('locale').notNull(),
      status: exportStatus('status').notNull().default('queued'),
      rowCount: integer('row_count'),
      fileMediaId: uuid('file_media_id'),
      fileName: text('file_name'),
      error: text('error'),
      createdBy: uuid('created_by').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      finishedAt: timestamp('finished_at', { withTimezone: true }),
      expiresAt: timestamp('expires_at', { withTimezone: true }),
      /** The schedule's send that made it (decision D122); null when someone asked for it. */
      scheduleId: uuid('schedule_id'),
      runId: uuid('run_id'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('export_jobs_tenant_user_created').on(table.tenantId, table.createdBy, table.createdAt),
      index('export_jobs_tenant_expires').on(table.tenantId, table.expiresAt),
      foreignKey({
        name: 'export_jobs_file_fk',
        columns: [table.tenantId, table.fileMediaId],
        foreignColumns: [media.tenantId, media.id],
      }),
      foreignKey({
        name: 'export_jobs_user_fk',
        columns: [table.tenantId, table.createdBy],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'export_jobs_run_fk',
        columns: [table.tenantId, table.runId],
        foreignColumns: [reportScheduleRuns.tenantId, reportScheduleRuns.id],
      }),
      index('export_jobs_tenant_run').on(table.tenantId, table.runId),
      isolation(),
    ],
  )
  .enableRLS();
