import { describe, expect, it } from 'vitest';
import {
  recordCutoffs,
  daysBefore,
  LOCATION_PARTITION_KEEP_DAYS,
  LOCATION_SETTLE_DAYS,
  locationRetention,
} from './retention';
import { SETTING_DEFAULTS, TenantSettings } from './schemas/tenant-config';

describe('location retention (BR-41)', () => {
  it('archives a day once no phone can send points for it', () => {
    expect(
      locationRetention({
        today: '2026-10-23',
        rawLocationRetentionDays: 35,
        trailRetentionDays: 365,
      }),
    ).toEqual({
      archiveThrough: '2026-10-15',
      purgeBefore: '2026-09-18',
      trailsBefore: '2025-10-23',
    });
  });

  it('purges only archived days, even at the shortest retention', () => {
    const rules = locationRetention({
      today: '2026-03-01',
      rawLocationRetentionDays: 7,
      trailRetentionDays: 90,
    });
    expect(rules).toEqual({
      archiveThrough: '2026-02-21',
      purgeBefore: '2026-02-22',
      trailsBefore: '2025-12-01',
    });
    // Purged days are those before purgeBefore, so the latest is archiveThrough itself.
    expect(daysBefore(rules.purgeBefore, 1) <= rules.archiveThrough).toBe(true);
  });

  it('waits out the longest sync window a tenant may choose', () => {
    expect(LOCATION_SETTLE_DAYS).toBe(8);
    expect(() =>
      TenantSettings.parse({
        ...SETTING_DEFAULTS,
        syncWindowHours: 24 * (LOCATION_SETTLE_DAYS - 1) + 1,
      }),
    ).toThrow();
    expect(LOCATION_PARTITION_KEEP_DAYS).toBe(99);
  });

  it('counts days across months and leap years', () => {
    expect(daysBefore('2028-03-01', 1)).toBe('2028-02-29');
    expect(daysBefore('2027-01-01', 365)).toBe('2026-01-01');
  });
});

describe('record retention (decision D95)', () => {
  it('counts notifications and import files in days, and the audit in calendar years', () => {
    const now = new Date('2028-02-29T10:00:00.000Z');
    expect(
      recordCutoffs(
        { notificationRetentionDays: 90, importFileRetentionDays: 30, auditRetentionYears: 3 },
        now,
      ),
    ).toEqual({
      notifications: new Date('2027-12-01T10:00:00.000Z'),
      importFiles: new Date('2028-01-30T10:00:00.000Z'),
      audit: new Date('2025-03-01T10:00:00.000Z'),
    });
  });
});
