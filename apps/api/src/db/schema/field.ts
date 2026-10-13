import type { AttendanceRule } from '@kshetra/shared';
import { LOCATION_SOURCES, PHASE1_DAY_STATUSES, SHIFT_END_REASONS } from '@kshetra/shared';
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
import { cell, geographyPoint, isolation } from './common';
import { devices, users } from './iam';
import { media } from './media';

/**
 * Shifts and location tracking (M5, spec 10.3, 12.1), owned by the field module: shifts and
 * their pauses, the raw points (partitioned by day), compacted trails, each person's last
 * position, attendance days, and the tenant's attendance rule.
 */

export const shiftEndReason = cell.enum('shift_end_reason', SHIFT_END_REASONS);
export const locationSource = cell.enum('location_source', LOCATION_SOURCES);
export const dayStatus = cell.enum('day_status', PHASE1_DAY_STATUSES);

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
      /** Where the day's raw points were archived; null until the archive lands (step 17). */
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
