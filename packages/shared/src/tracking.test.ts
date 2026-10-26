import { describe, expect, it } from 'vitest';
import {
  clockSkewed,
  compactTrail,
  dayStatus,
  encodePolyline,
  shiftOdometerKm,
  odometerIssue,
  onDutyMs,
  pointRejection,
  punchFixIssue,
  simplifyTrail,
  trailGaps,
  gapBefore,
} from './tracking';

const H = 3_600_000;
const START = Date.parse('2026-10-13T03:30:00Z');
const ME = 'user-a';
const context = { userId: ME, now: START + 2 * H, maxShiftHours: 14, syncWindowHours: 72 };
const shift = { userId: ME, startedAt: START, endedAt: null };
const point = (
  capturedAt: number,
  overrides: Partial<{ accuracy: number; mocked: boolean }> = {},
) => ({
  capturedAt,
  accuracy: 20,
  mocked: false,
  ...overrides,
});

describe('BR-36: which location points count', () => {
  it('accepts a real, close point on the sender’s own open shift', () => {
    expect(pointRejection(point(START + H), shift, context)).toBeNull();
    expect(pointRejection(point(START - 5_000), shift, context)).toBeNull();
  });

  it('refuses mocked and vague points, and points on no shift or someone else’s', () => {
    expect(pointRejection(point(START + H, { mocked: true }), shift, context)).toBe('MOCKED');
    expect(pointRejection(point(START + H, { accuracy: 251 }), shift, context)).toBe('INACCURATE');
    expect(pointRejection(point(START + H, { accuracy: Number.NaN }), shift, context)).toBe(
      'INACCURATE',
    );
    expect(pointRejection(point(START + H), null, context)).toBe('NOT_YOUR_SHIFT');
    expect(pointRejection(point(START + H), { ...shift, userId: 'user-b' }, context)).toBe(
      'NOT_YOUR_SHIFT',
    );
  });

  it('keeps points to the shift: 5 s before it, 60 s after it, and its longest length', () => {
    expect(pointRejection(point(START - 5_001), shift, context)).toBe('OUTSIDE_SHIFT');
    const ended = { ...shift, endedAt: START + 8 * H };
    expect(pointRejection(point(START + 8 * H + 60_000), ended, context)).toBeNull();
    expect(pointRejection(point(START + 8 * H + 60_001), ended, context)).toBe('OUTSIDE_SHIFT');
    expect(
      pointRejection(point(START + 14 * H + 1), shift, { ...context, now: START + 15 * H }),
    ).toBe('SHIFT_EXPIRED');
  });

  it('refuses a point older than the sync window', () => {
    expect(pointRejection(point(START + H), shift, { ...context, now: START + H + 73 * H })).toBe(
      'SYNC_WINDOW',
    );
  });
});

describe('punching in and out (M5)', () => {
  it('needs a real fix of 250 m or better', () => {
    expect(punchFixIssue({ accuracy: 250, mocked: false })).toBeNull();
    expect(punchFixIssue({ accuracy: 251, mocked: false })).toBe('GPS_INACCURATE');
    expect(punchFixIssue({ accuracy: 10, mocked: true })).toBe('GPS_MOCKED');
  });

  it('BR-44: flags a clock more than 10 minutes from the server’s', () => {
    expect(clockSkewed(null)).toBe(false);
    expect(clockSkewed(600)).toBe(false);
    expect(clockSkewed(-601)).toBe(true);
  });

  it('counts time on duty without pauses, clipped to the shift', () => {
    const day = { startedAt: START, endedAt: START + 9 * H };
    expect(onDutyMs(day, [])).toBe(9 * H);
    expect(
      onDutyMs(day, [
        { pausedAt: START + H, resumedAt: START + 2 * H },
        { pausedAt: START + 8.5 * H, resumedAt: null },
        { pausedAt: START - H, resumedAt: START + 0.5 * H },
      ]),
    ).toBe(9 * H - H - 0.5 * H - 0.5 * H);
  });
});

describe('odometer readings at punches (decision D99)', () => {
  it('asks for them only where the tenant does, and never below the opening one', () => {
    expect(odometerIssue('off', undefined)).toBeNull();
    // Sent though not asked for: ignored, not refused.
    expect(odometerIssue('off', '100.5')).toBeNull();
    expect(odometerIssue('optional', undefined)).toBeNull();
    expect(odometerIssue('required', undefined)).toBe('required');
    expect(odometerIssue('required', '12045')).toBeNull();
    expect(odometerIssue('optional', '12045', '12045.0')).toBeNull();
    expect(odometerIssue('optional', '12044.9', '12045')).toBe('below_opening');
    // A closing reading without an opening one has nothing to fall below.
    expect(odometerIssue('required', '3', null)).toBeNull();
  });

  it('counts the kilometres between them, to a tenth', () => {
    expect(shiftOdometerKm('12045', '12098.5')).toBe('53.5');
    expect(shiftOdometerKm('12045.3', '12045.3')).toBe('0.0');
    expect(shiftOdometerKm('12045', null)).toBeNull();
    expect(shiftOdometerKm(undefined, '1')).toBeNull();
  });
});

describe('trails (spec 12.1)', () => {
  it('finds silences longer than 10 minutes', () => {
    const at = (minutes: number) => ({
      lat: 28.6,
      lng: 77.2,
      accuracy: 10,
      capturedAt: START + minutes * 60_000,
    });
    expect(trailGaps([at(0), at(5), at(16), at(20)])).toEqual([
      { from: START + 5 * 60_000, to: START + 16 * 60_000 },
    ]);
  });

  it('marks a point after a silence as the trail counts gaps, within one shift (decision D99)', () => {
    const point = (shiftId: string, minutes: number) => ({
      shiftId,
      capturedAt: START + minutes * 60_000,
    });
    expect(gapBefore(null, point('a', 0))).toBeNull();
    expect(gapBefore(point('a', 5), point('a', 15))).toBeNull();
    expect(gapBefore(point('a', 5), point('a', 16))).toBe(11);
    expect(gapBefore(point('a', 5), point('a', 47.5))).toBe(42);
    // A new shift begins without a gap, however long the night was.
    expect(gapBefore(point('a', 5), point('b', 600))).toBeNull();
  });

  it('simplifies a straight walk to its ends, and keeps a turn', () => {
    const straight = [0, 1, 2, 3, 4].map((step) => ({ lat: 28.6 + step * 0.001, lng: 77.2 }));
    expect(simplifyTrail(straight)).toEqual([straight[0], straight[4]]);
    const turn = [...straight, { lat: 28.604, lng: 77.205 }];
    expect(simplifyTrail(turn)).toEqual([straight[0], straight[4], turn[5]]);
    // A wobble under 10 m goes; one of about 55 m stays.
    const wobble = [straight[0]!, { lat: 28.6005, lng: 77.20005 }, straight[2]!];
    expect(simplifyTrail(wobble)).toEqual([straight[0], straight[2]]);
    const detour = [straight[0]!, { lat: 28.6005, lng: 77.2006 }, straight[2]!];
    expect(simplifyTrail(detour)).toHaveLength(3);
  });

  it('encodes Google’s worked example', () => {
    expect(
      encodePolyline([
        { lat: 38.5, lng: -120.2 },
        { lat: 40.7, lng: -120.95 },
        { lat: 43.252, lng: -126.453 },
      ]),
    ).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('compacts only accurate fixes, in time order', () => {
    const fix = (minutes: number, lat: number, accuracy = 10) => ({
      lat,
      lng: 77.2,
      accuracy,
      capturedAt: START + minutes * 60_000,
    });
    const trail = compactTrail([fix(2, 28.602), fix(0, 28.6), fix(1, 28.601), fix(3, 28.7, 150)]);
    expect(trail).toMatchObject({ pointCount: 4, keptCount: 2, gaps: [] });
    expect(trail.polyline).toBe(
      encodePolyline([
        { lat: 28.6, lng: 77.2 },
        { lat: 28.602, lng: 77.2 },
      ]),
    );
  });
});

describe('BR-23, as shifts decide it', () => {
  const day = {
    date: '2026-10-13',
    today: '2026-10-13',
    joiningDate: '2026-01-01',
    exitDate: null,
    shifts: 1,
    hours: 3,
    rule: { rule: 'punch_is_present' as const },
  };

  it('counts any shift as present under the punch rule', () => {
    expect(dayStatus(day)).toEqual({ status: 'present', value: 1 });
    expect(dayStatus({ ...day, shifts: 0, hours: 0 })).toEqual({ status: 'absent', value: 0 });
  });

  it('goes by hours under the hours rule', () => {
    const rule = { rule: 'hours' as const, fullDayHours: 8, halfDayHours: 4 };
    expect(dayStatus({ ...day, rule, hours: 8 })).toEqual({ status: 'present', value: 1 });
    expect(dayStatus({ ...day, rule, hours: 4 })).toEqual({ status: 'half_day', value: 0.5 });
    expect(dayStatus({ ...day, rule, hours: 3.9 })).toEqual({ status: 'absent', value: 0 });
  });

  it('puts days ahead and outside employment first', () => {
    expect(dayStatus({ ...day, date: '2026-10-14' })).toEqual({ status: 'future', value: 0 });
    expect(dayStatus({ ...day, date: '2025-12-31' })).toEqual({ status: 'not_employed', value: 0 });
    expect(dayStatus({ ...day, exitDate: '2026-10-12' })).toEqual({
      status: 'not_employed',
      value: 0,
    });
  });
});

describe('BR-23 in full (decision D80)', () => {
  const day = {
    date: '2026-10-13',
    today: '2026-10-20',
    joiningDate: '2026-01-01',
    exitDate: null,
    shifts: 0,
    hours: 0,
    rule: { rule: 'punch_is_present' as const },
  };

  it('FX-19: a shift wins over approved paid leave', () => {
    expect(dayStatus({ ...day, shifts: 1, leave: { paid: true, half: false } })).toEqual({
      status: 'present',
      value: 1,
    });
  });

  it('goes regularisation, leave, holiday, weekly off, then absent', () => {
    expect(dayStatus({ ...day, regularised: 'present', holiday: true })).toEqual({
      status: 'present',
      value: 1,
    });
    expect(
      dayStatus({ ...day, regularised: 'half_day', leave: { paid: true, half: false } }),
    ).toEqual({
      status: 'half_day',
      value: 0.5,
    });
    expect(dayStatus({ ...day, leave: { paid: true, half: true }, holiday: true })).toEqual({
      status: 'paid_leave',
      value: 0.5,
    });
    expect(dayStatus({ ...day, leave: { paid: false, half: false } })).toEqual({
      status: 'unpaid_leave',
      value: 0,
    });
    expect(dayStatus({ ...day, holiday: true, weeklyOff: true })).toEqual({
      status: 'holiday',
      value: 0,
    });
    expect(dayStatus({ ...day, weeklyOff: true })).toEqual({ status: 'weekly_off', value: 0 });
    expect(dayStatus(day)).toEqual({ status: 'absent', value: 0 });
  });

  it('lets half-day hours stand with a half-day regularisation', () => {
    const rule = { rule: 'hours' as const, fullDayHours: 8, halfDayHours: 4 };
    expect(dayStatus({ ...day, rule, hours: 5, regularised: 'present' })).toEqual({
      status: 'present',
      value: 1,
    });
    expect(dayStatus({ ...day, rule, hours: 5 })).toEqual({ status: 'half_day', value: 0.5 });
  });
});
