/**
 * BR-41 for location data (decision D69): which of a tenant's days are ready for the archive,
 * which may leave the database, and before which date trails and archives go. Dates are
 * `YYYY-MM-DD` on the tenant's clock.
 */

/** The longest a tenant may let phones hold records before sending them (`syncWindowHours`). */
export const SYNC_WINDOW_HOURS_MAX = 168;

/** The longest a tenant may keep raw points (`rawLocationRetentionDays`). */
export const RAW_LOCATION_RETENTION_DAYS_MAX = 90;

/**
 * Days after which no point can arrive for a day: the longest sync window, and one more day for a
 * phone whose window began late in that day. The longest, not the tenant's own, so a window made
 * longer later can't send points into a day already archived.
 */
export const LOCATION_SETTLE_DAYS = Math.ceil(SYNC_WINDOW_HOURS_MAX / 24) + 1;

/**
 * How many days back a day's partition of raw points may be dropped once empty: past every
 * tenant's retention and the settling time, with a day to spare for time zones.
 */
export const LOCATION_PARTITION_KEEP_DAYS =
  RAW_LOCATION_RETENTION_DAYS_MAX + LOCATION_SETTLE_DAYS + 1;

/** The date `days` before a `YYYY-MM-DD` date. */
export function daysBefore(date: string, days: number): string {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() - days);
  return moment.toISOString().slice(0, 10);
}

export interface LocationRetention {
  /** The last day whose raw points are archived: a day phones can no longer send points for. */
  archiveThrough: string;
  /** Raw points of archived days before this date leave the database. */
  purgeBefore: string;
  /** Trails, and the archived days' files, before this date are removed. */
  trailsBefore: string;
}

export function locationRetention(settings: {
  today: string;
  rawLocationRetentionDays: number;
  trailRetentionDays: number;
}): LocationRetention {
  return {
    archiveThrough: daysBefore(settings.today, LOCATION_SETTLE_DAYS),
    purgeBefore: daysBefore(settings.today, settings.rawLocationRetentionDays),
    trailsBefore: daysBefore(settings.today, settings.trailRetentionDays),
  };
}

/** The keeping times of the classes the nightly governance job removes (decision D95). */
export interface RecordRetention {
  notificationRetentionDays: number;
  importFileRetentionDays: number;
  auditRetentionYears: number;
}

/**
 * The moments before which each class goes (BR-41, decision D95): notifications and import files
 * by days, the audit log by whole years back from `now`, on the calendar, so a leap year changes
 * nothing.
 */
export function recordCutoffs(
  settings: RecordRetention,
  now: Date,
): { notifications: Date; importFiles: Date; audit: Date } {
  const day = 86_400_000;
  const audit = new Date(now);
  audit.setUTCFullYear(audit.getUTCFullYear() - settings.auditRetentionYears);
  return {
    notifications: new Date(now.getTime() - settings.notificationRetentionDays * day),
    importFiles: new Date(now.getTime() - settings.importFileRetentionDays * day),
    audit,
  };
}
