import { describe, expect, it } from 'vitest';
import { evidenceIssues, geofenceResult, photoIssues } from './evidence';

const H = 3_600_000;
const NOW = Date.parse('2026-10-14T06:00:00Z');
const ME = 'user-a';
const shift = { userId: ME, startedAt: NOW - 4 * H, endedAt: null };
const context = {
  userId: ME,
  now: NOW,
  maxShiftHours: 14,
  syncWindowHours: 72,
  offShiftAllowed: false,
};
const record = (
  capturedAt = NOW - 60_000,
  fix: Partial<{ capturedAt: number; accuracy: number; mocked: boolean }> = {},
) => ({
  capturedAt,
  fix: { capturedAt: capturedAt - 30_000, accuracy: 20, mocked: false, ...fix },
});
const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe('BR-33: the geofence', () => {
  it('counts a fix inside when the distance is within the radius plus the capped accuracy', () => {
    expect(geofenceResult({ distanceM: 300, radiusM: 300, accuracyM: 0, accuracyCapM: 100 })).toBe(
      'inside',
    );
    expect(geofenceResult({ distanceM: 390, radiusM: 300, accuracyM: 90, accuracyCapM: 100 })).toBe(
      'inside',
    );
    expect(
      geofenceResult({ distanceM: 410, radiusM: 300, accuracyM: 200, accuracyCapM: 100 }),
    ).toBe('outside');
  });

  it('is unknown without a verified location', () => {
    expect(
      geofenceResult({ distanceM: null, radiusM: 300, accuracyM: 10, accuracyCapM: 100 }),
    ).toBe('unknown');
  });
});

describe('BR-32: evidence', () => {
  it('passes a real, fresh fix on the person’s own shift', () => {
    expect(evidenceIssues(record(), shift, context)).toEqual([]);
  });

  it('refuses a mocked, vague or stale fix', () => {
    expect(codes(evidenceIssues(record(undefined, { mocked: true }), shift, context))).toEqual([
      'GPS_MOCKED',
    ]);
    expect(codes(evidenceIssues(record(undefined, { accuracy: 300 }), shift, context))).toEqual([
      'GPS_INACCURATE',
    ]);
    const capture = NOW - 60_000;
    expect(
      codes(evidenceIssues(record(capture, { capturedAt: capture - 121_000 }), shift, context)),
    ).toEqual(['GPS_STALE']);
  });

  it('keeps capture to the shift, unless the form allows off-shift capture', () => {
    expect(codes(evidenceIssues(record(), null, context))).toEqual(['NOT_ON_SHIFT']);
    expect(codes(evidenceIssues(record(), { ...shift, userId: 'user-b' }, context))).toEqual([
      'NOT_ON_SHIFT',
    ]);
    expect(codes(evidenceIssues(record(NOW - 5 * H), shift, context))).toEqual(['OUTSIDE_SHIFT']);
    const ended = { ...shift, endedAt: NOW - 2 * H };
    expect(codes(evidenceIssues(record(NOW - H), ended, context))).toEqual(['OUTSIDE_SHIFT']);
    const long = { ...shift, startedAt: NOW - 15 * H };
    expect(codes(evidenceIssues(record(NOW - 30 * 60_000), long, context))).toEqual([
      'SHIFT_EXPIRED',
    ]);
    expect(evidenceIssues(record(), null, { ...context, offShiftAllowed: true })).toEqual([]);
  });

  it('refuses a capture in the future or past the sync window', () => {
    expect(codes(evidenceIssues(record(NOW + 3 * 60_000), shift, context))).toEqual(['VALIDATION']);
    const old = { ...shift, startedAt: NOW - 80 * H };
    expect(
      codes(evidenceIssues(record(NOW - 73 * H), old, { ...context, maxShiftHours: 24 })),
    ).toContain('SYNC_WINDOW');
  });
});

describe('BR-32: photos', () => {
  const here = { lat: 28.6315, lng: 77.2167 };
  const submission = { id: 'sub-1', userId: ME, capturedAt: NOW, point: here };
  const photo = (overrides: object = {}) => ({
    id: 'photo-1',
    userId: ME,
    ownerId: null,
    capturedAt: NOW - 60_000,
    point: here,
    source: 'camera' as const,
    ...overrides,
  });

  it('takes the person’s own camera photos, taken close by and just before', () => {
    expect(
      photoIssues([photo(), photo({ id: 'p2', ownerId: 'sub-1' })], submission, {
        galleryAllowed: false,
      }),
    ).toEqual([]);
  });

  it('refuses someone else’s, another record’s, a gallery photo the form forbids, and far ones', () => {
    const issues = photoIssues(
      [
        photo({ id: 'a', userId: 'user-b' }),
        photo({ id: 'b', ownerId: 'sub-2' }),
        photo({ id: 'c', source: 'gallery' }),
        photo({ id: 'd', capturedAt: NOW - 6 * 60_000 }),
        photo({ id: 'e', point: { lat: 28.6415, lng: 77.2167 } }),
      ],
      submission,
      { galleryAllowed: false },
    );
    expect(issues.map((issue) => issue.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(
      photoIssues([photo({ source: 'gallery' })], submission, { galleryAllowed: true }),
    ).toEqual([]);
  });
});
