import type { AttendanceRule, Signature } from '@kshetra/shared';
import {
  GEOFENCE_RESULTS,
  LOCATION_SOURCES,
  PHASE1_DAY_STATUSES,
  SHIFT_END_REASONS,
  SUBMISSION_FLAGS,
  SUBMISSION_STATUSES,
  VISIT_END_REASONS,
} from '@kshetra/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { cell, geographyPoint, isolation, rowVersionColumn } from './common';
import { formVersions } from './forms';
import { devices, users } from './iam';
import { media } from './media';

/**
 * Shifts and location tracking (M5, spec 10.3, 12.1), owned by the field module: shifts and
 * their pauses, the raw points (partitioned by day), compacted trails, each person's last
 * position, attendance days, and the tenant's attendance rule. Visits and submissions (M6) live
 * here too.
 */

export const shiftEndReason = cell.enum('shift_end_reason', SHIFT_END_REASONS);
export const locationSource = cell.enum('location_source', LOCATION_SOURCES);
export const dayStatus = cell.enum('day_status', PHASE1_DAY_STATUSES);
export const geofenceResult = cell.enum('geofence_result', GEOFENCE_RESULTS);
export const visitEndReason = cell.enum('visit_end_reason', VISIT_END_REASONS);
export const submissionStatus = cell.enum('submission_status', SUBMISSION_STATUSES);
export const submissionFlag = cell.enum('submission_flag', SUBMISSION_FLAGS);

const at = (name: string) => timestamp(name, { withTimezone: true });

export const shifts = cell
  .table(
    'shifts',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      deviceId: uuid('device_id'),
      startedAt: at('started_at').notNull(),
      startPoint: geographyPoint('start_point').notNull(),
      startAccuracy: real('start_accuracy').notNull(),
      consentVersion: text('consent_version').notNull(),
      selfieMediaId: uuid('selfie_media_id'),
      endedAt: at('ended_at'),
      endPoint: geographyPoint('end_point'),
      endAccuracy: real('end_accuracy'),
      endReason: shiftEndReason('end_reason'),
      distanceM: integer('distance_m'),
      onDutySeconds: integer('on_duty_seconds'),
      /** BR-44: the phone's clock was over 10 minutes out when it sent the punch. */
      clockSkew: boolean('clock_skew').notNull().default(false),
      /** When the nightly job compacted the trail; null until then. */
      compactedAt: at('compacted_at'),
      receivedAt: at('received_at').notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('shifts_tenant_user_started').on(table.tenantId, table.userId, table.startedAt),
      // Only one shift can be open per user (M5).
      uniqueIndex('shifts_one_open')
        .on(table.tenantId, table.userId)
        .where(sql`${table.endedAt} is null`),
      index('shifts_tenant_to_compact')
        .on(table.tenantId, table.endedAt)
        .where(sql`${table.endedAt} is not null and ${table.compactedAt} is null`),
      foreignKey({
        name: 'shifts_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'shifts_device_fk',
        columns: [table.tenantId, table.deviceId],
        foreignColumns: [devices.tenantId, devices.id],
      }),
      foreignKey({
        name: 'shifts_selfie_fk',
        columns: [table.tenantId, table.selfieMediaId],
        foreignColumns: [media.tenantId, media.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

export const shiftPauses = cell
  .table(
    'shift_pauses',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      shiftId: uuid('shift_id').notNull(),
      pausedAt: at('paused_at').notNull(),
      resumedAt: at('resumed_at'),
      reason: text('reason').notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('shift_pauses_tenant_shift').on(table.tenantId, table.shiftId, table.pausedAt),
      // One pause at a time on a shift.
      uniqueIndex('shift_pauses_one_open')
        .on(table.tenantId, table.shiftId)
        .where(sql`${table.resumedAt} is null`),
      foreignKey({
        name: 'shift_pauses_shift_fk',
        columns: [table.tenantId, table.shiftId],
        foreignColumns: [shifts.tenantId, shifts.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * Raw points (spec 12.1). The table is range-partitioned by day on `captured_at` (pg_partman,
 * decision D47), which Drizzle can't declare: migration 0018 creates it partitioned. The primary
 * key carries `captured_at`, as a partitioned table's must, and keeps replays idempotent.
 */
export const locationPoints = cell
  .table(
    'location_points',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid('id').notNull(),
      shiftId: uuid('shift_id').notNull(),
      userId: uuid('user_id').notNull(),
      capturedAt: at('captured_at').notNull(),
      receivedAt: at('received_at').notNull().defaultNow(),
      point: geographyPoint('point').notNull(),
      accuracy: real('accuracy').notNull(),
      speed: real('speed'),
      source: locationSource('source').notNull(),
      battery: smallint('battery'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.capturedAt, table.id] }),
      index('location_points_tenant_shift').on(table.tenantId, table.shiftId, table.capturedAt),
      isolation(),
    ],
  )
  .enableRLS();

/** A finished shift's compacted trail (spec 12.1): what outlives the raw points. */
export const shiftTrails = cell
  .table(
    'shift_trails',
    {
      tenantId: uuid('tenant_id').notNull(),
      shiftId: uuid('shift_id').notNull(),
      userId: uuid('user_id').notNull(),
      date: date('date').notNull(),
      polyline: text('polyline').notNull(),
      pointCount: integer('point_count').notNull(),
      keptCount: integer('kept_count').notNull(),
      distanceM: integer('distance_m').notNull(),
      gaps: jsonb('gaps').$type<{ from: string; to: string }[]>().notNull(),
      pauses: jsonb('pauses').$type<{ from: string; to: string | null }[]>().notNull(),
      /** Unused: raw points are archived by tenant and day in `location_archives` (D69). */
      archivedKey: text('archived_key'),
      createdAt: at('created_at').notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.shiftId] }),
      index('shift_trails_tenant_user_date').on(table.tenantId, table.userId, table.date),
      foreignKey({
        name: 'shift_trails_shift_fk',
        columns: [table.tenantId, table.shiftId],
        foreignColumns: [shifts.tenantId, shifts.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * The tenant's raw points of one day on its clock, archived to the object store as Parquet
 * (spec 10.3, BR-41, decision D69): one row a part, each part a file of up to 200,000 points.
 * A day without points has one part with no file, so it isn't looked at again. Once every part of
 * a day is stored, its points may leave the database (`purged_at`); the files are kept as long as
 * trails, then expired.
 */
export const locationArchives = cell
  .table(
    'location_archives',
    {
      tenantId: uuid('tenant_id').notNull(),
      date: date('date').notNull(),
      part: smallint('part').notNull(),
      mediaId: uuid('media_id'),
      points: integer('points').notNull(),
      createdAt: at('created_at').notNull().defaultNow(),
      purgedAt: at('purged_at'),
      expiredAt: at('expired_at'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.date, table.part] }),
      foreignKey({
        name: 'location_archives_media_fk',
        columns: [table.tenantId, table.mediaId],
        foreignColumns: [media.tenantId, media.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** Where each person was last seen on duty, for the live map (M17). */
export const userLastPosition = cell
  .table(
    'user_last_position',
    {
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      shiftId: uuid('shift_id').notNull(),
      capturedAt: at('captured_at').notNull(),
      point: geographyPoint('point').notNull(),
      accuracy: real('accuracy').notNull(),
      battery: smallint('battery'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.userId] }),
      foreignKey({
        name: 'user_last_position_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** Each person's day (BR-23 as shifts decide it in phase 1, decision D47). */
export const attendanceDays = cell
  .table(
    'attendance_days',
    {
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      date: date('date').notNull(),
      status: dayStatus('status').notNull(),
      value: numeric('value', { precision: 3, scale: 1 }).notNull(),
      firstIn: at('first_in'),
      lastOut: at('last_out'),
      hours: numeric('hours', { precision: 5, scale: 2 }).notNull(),
      source: jsonb('source').$type<{ shifts: string[] }>().notNull(),
      computedAt: at('computed_at').notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.userId, table.date] }),
      foreignKey({
        name: 'attendance_days_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/** What makes a day present for the tenant (spec 5.10), from its template. */
export const attendancePolicies = cell
  .table(
    'attendance_policies',
    {
      tenantId: uuid('tenant_id').notNull().primaryKey(),
      rule: jsonb('rule').$type<AttendanceRule>().notNull(),
    },
    () => [isolation()],
  )
  .enableRLS();

/** A checked-in period at an account (M6), which holds the submissions made during it. */
export const visits = cell
  .table(
    'visits',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      shiftId: uuid('shift_id').notNull(),
      accountId: uuid('account_id').notNull(),
      /** The planned visit it carries out (M8); the planning module keeps the item. */
      planItemId: uuid('plan_item_id'),
      deviceId: uuid('device_id'),
      checkInAt: at('check_in_at').notNull(),
      checkInPoint: geographyPoint('check_in_point').notNull(),
      checkInAccuracy: real('check_in_accuracy').notNull(),
      /** Metres from the account's verified location at check-in; null without one (BR-33). */
      distanceM: integer('distance_m'),
      geofence: geofenceResult('geofence').notNull(),
      checkOutAt: at('check_out_at'),
      checkOutPoint: geographyPoint('check_out_point'),
      checkOutAccuracy: real('check_out_accuracy'),
      endReason: visitEndReason('end_reason'),
      /** BR-44: the phone's clock was over 10 minutes out at check-in. */
      clockSkew: boolean('clock_skew').notNull().default(false),
      receivedAt: at('received_at').notNull().defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('visits_tenant_account_check_in').on(table.tenantId, table.accountId, table.checkInAt),
      index('visits_tenant_user_check_in').on(table.tenantId, table.userId, table.checkInAt),
      // One visit is open per person at a time (M6).
      uniqueIndex('visits_one_open')
        .on(table.tenantId, table.userId)
        .where(sql`${table.checkOutAt} is null`),
      foreignKey({
        name: 'visits_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'visits_shift_fk',
        columns: [table.tenantId, table.shiftId],
        foreignColumns: [shifts.tenantId, shifts.id],
      }),
      foreignKey({
        name: 'visits_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      foreignKey({
        name: 'visits_device_fk',
        columns: [table.tenantId, table.deviceId],
        foreignColumns: [devices.tenantId, devices.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();

/**
 * A form filled in the field (M6), immutable once received: the form version it was filled on,
 * when and where, its values, and what reviewers should see. Unpartitioned at launch (spec 10.4).
 * Its photos are media rows owned by it; the form's own photos keep their order in `photo_ids`.
 */
export const submissions = cell
  .table(
    'submissions',
    {
      id: uuid('id').notNull(),
      tenantId: uuid('tenant_id').notNull(),
      userId: uuid('user_id').notNull(),
      shiftId: uuid('shift_id'),
      visitId: uuid('visit_id'),
      accountId: uuid('account_id'),
      formId: uuid('form_id').notNull(),
      formVersion: integer('form_version').notNull(),
      deviceId: uuid('device_id'),
      capturedAt: at('captured_at').notNull(),
      receivedAt: at('received_at').notNull().defaultNow(),
      point: geographyPoint('point').notNull(),
      accuracy: real('accuracy').notNull(),
      gpsAt: at('gps_at').notNull(),
      mocked: boolean('mocked').notNull(),
      data: jsonb('data').$type<Record<string, unknown>>().notNull(),
      photoIds: uuid('photo_ids')
        .array()
        .notNull()
        .default(sql`'{}'::uuid[]`),
      /** The signature as the phone drew it; the media worker renders it to an image. */
      signatureStrokes: jsonb('signature_strokes').$type<Signature>(),
      signatureMediaId: uuid('signature_media_id'),
      distanceM: integer('distance_m'),
      geofence: geofenceResult('geofence'),
      flags: submissionFlag('flags')
        .array()
        .notNull()
        .default(sql`'{}'`),
      status: submissionStatus('status').notNull(),
      autoApproved: boolean('auto_approved').notNull().default(false),
      /** When auto-approval may approve it (M7); null when it never will. */
      autoApproveAt: at('auto_approve_at'),
      rowVersion: rowVersionColumn(),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      index('submissions_tenant_user_captured').on(table.tenantId, table.userId, table.capturedAt),
      index('submissions_tenant_status_captured').on(
        table.tenantId,
        table.status,
        table.capturedAt,
      ),
      index('submissions_tenant_account_captured').on(
        table.tenantId,
        table.accountId,
        table.capturedAt,
      ),
      index('submissions_tenant_visit').on(table.tenantId, table.visitId),
      index('submissions_tenant_auto_approve')
        .on(table.tenantId, table.autoApproveAt)
        .where(sql`${table.status} = 'pending' and ${table.autoApproveAt} is not null`),
      index('submissions_tenant_row_version').on(table.tenantId, table.rowVersion, table.id),
      index('submissions_point').using('gist', table.point),
      foreignKey({
        name: 'submissions_user_fk',
        columns: [table.tenantId, table.userId],
        foreignColumns: [users.tenantId, users.id],
      }),
      foreignKey({
        name: 'submissions_shift_fk',
        columns: [table.tenantId, table.shiftId],
        foreignColumns: [shifts.tenantId, shifts.id],
      }),
      foreignKey({
        name: 'submissions_visit_fk',
        columns: [table.tenantId, table.visitId],
        foreignColumns: [visits.tenantId, visits.id],
      }),
      foreignKey({
        name: 'submissions_account_fk',
        columns: [table.tenantId, table.accountId],
        foreignColumns: [accounts.tenantId, accounts.id],
      }),
      foreignKey({
        name: 'submissions_form_version_fk',
        columns: [table.tenantId, table.formId, table.formVersion],
        foreignColumns: [formVersions.tenantId, formVersions.formId, formVersions.version],
      }),
      foreignKey({
        name: 'submissions_signature_fk',
        columns: [table.tenantId, table.signatureMediaId],
        foreignColumns: [media.tenantId, media.id],
      }),
      foreignKey({
        name: 'submissions_device_fk',
        columns: [table.tenantId, table.deviceId],
        foreignColumns: [devices.tenantId, devices.id],
      }),
      isolation(),
    ],
  )
  .enableRLS();
