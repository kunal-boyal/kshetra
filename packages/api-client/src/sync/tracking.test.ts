import type { LocationPointBody } from '@thelamp/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './local-schema';
import { nodeSqlite } from './node-sqlite';
import type { SqlDatabase } from './sql';
import { FLUSH_LIMIT, type RawPoint, Tracking } from './tracking';

const ME = 'tenant-a:user-a';
const SHIFT = '01a10000-0000-7000-8000-0000000000d1';
const START = Date.parse('2026-10-13T03:30:00Z');
const H = 3_600_000;

let db: SqlDatabase;
let tracking: Tracking;

beforeEach(async () => {
  db = nodeSqlite();
  await migrate(db);
  tracking = new Tracking(db);
});

let n = 0;
const raw = (minutes: number, overrides: Partial<RawPoint> = {}): RawPoint => {
  n += 1;
  return {
    id: `01a10000-0000-7000-8000-${String(n).padStart(12, '0')}`,
    capturedAt: START + minutes * 60_000,
    lat: 28.6,
    lng: 77.2,
    accuracy: 12,
    speed: null,
    mocked: false,
    battery: 80,
    source: 'background',
    ...overrides,
  };
};

const open = () =>
  db.transaction((tx) =>
    tracking.open(tx, {
      owner: ME,
      shiftId: SHIFT,
      startedAt: START,
      endsBy: START + 14 * H,
      intervalSeconds: 60,
    }),
  );

describe('tracking on the phone (spec 12.1)', () => {
  it('keeps only what the server would accept', async () => {
    expect(await tracking.record(ME, [raw(1)])).toEqual({ kept: 0, dropped: { NO_SHIFT: 1 } });
    await open();
    const result = await tracking.record(ME, [
      raw(1),
      raw(2, { mocked: true }),
      raw(3, { accuracy: 400 }),
      raw(15 * 60),
      raw(4),
    ]);
    expect(result).toEqual({ kept: 2, dropped: { MOCKED: 1, INACCURATE: 1, PAST_LONGEST: 1 } });
    await db.transaction((tx) => tracking.pause(tx, ME, 'pause-1'));
    expect(await tracking.record(ME, [raw(5)])).toEqual({ kept: 0, dropped: { PAUSED: 1 } });
    await db.transaction((tx) => tracking.pause(tx, ME, null));
    expect((await tracking.record(ME, [raw(6)])).kept).toBe(1);
    expect(await tracking.waiting(ME)).toBe(3);
    expect(await tracking.waiting('tenant-a:user-b')).toBe(0);
  });

  it('adds up the distance walked, but not the wander of a phone standing still (D104)', async () => {
    await open();
    expect(await tracking.current(ME)).toMatchObject({ distanceMeters: 0, lastFix: null });
    // About 111 m a step north, then three readings jittering within their accuracy.
    await tracking.record(ME, [
      raw(1, { lat: 28.6 }),
      raw(2, { lat: 28.601 }),
      raw(3, { lat: 28.602 }),
      raw(4, { lat: 28.60205, accuracy: 20 }),
      raw(5, { lat: 28.60195, accuracy: 20 }),
    ]);
    const walked = (await tracking.current(ME))!;
    expect(walked.distanceMeters).toBeGreaterThan(220);
    expect(walked.distanceMeters).toBeLessThan(225);
    expect(walked.lastFix).toEqual({ lat: 28.602, lng: 77.2 });
    // Points handed over out of order count in time order.
    await tracking.record(ME, [raw(7, { lat: 28.604 }), raw(6, { lat: 28.603 })]);
    expect((await tracking.current(ME))!.distanceMeters).toBeGreaterThan(440);
    // A new shift starts at nothing.
    await db.transaction((tx) => tracking.close(tx, ME));
    await open();
    expect((await tracking.current(ME))!.distanceMeters).toBe(0);
  });

  it('uploads once the shift is known, 200 at a time, and drops what the server answered', async () => {
    await open();
    await tracking.record(
      ME,
      Array.from({ length: FLUSH_LIMIT + 50 }, (_, index) => raw(index / 10)),
    );
    const sent: LocationPointBody[][] = [];
    const send = async (points: LocationPointBody[]) => {
      sent.push(points);
      const [first, ...rest] = points;
      return {
        accepted: rest.map((point) => point.id),
        rejected: [{ id: first!.id, reason: 'INACCURATE' as const }],
      };
    };
    expect(await tracking.flush(ME, send, async () => false)).toEqual({ sent: 0 });
    expect(await tracking.flush(ME, send, async () => true)).toEqual({ sent: FLUSH_LIMIT + 50 });
    expect(sent.map((batch) => batch.length)).toEqual([FLUSH_LIMIT, 50]);
    expect(sent[0]![0]).toMatchObject({
      shiftId: SHIFT,
      capturedAt: new Date(START).toISOString(),
      location: { lat: 28.6, lng: 77.2 },
      mocked: false,
      source: 'background',
    });
    expect(await tracking.waiting(ME)).toBe(0);
  });

  it('keeps points when the upload fails, and after the shift closes on the phone', async () => {
    await open();
    await tracking.record(ME, [raw(1), raw(2)]);
    await db.transaction((tx) => tracking.close(tx, ME));
    expect(await tracking.current(ME)).toBeNull();
    await expect(
      tracking.flush(
        ME,
        async () => {
          throw new Error('offline');
        },
        async () => true,
      ),
    ).rejects.toThrow('offline');
    expect(await tracking.waiting(ME)).toBe(2);
  });

  it('keeps a shift’s odometer readings for the day’s fuel claim, after it closes', async () => {
    const other = '01a10000-0000-7000-8000-0000000000d2';
    await db.transaction(async (tx) => {
      await tracking.openOdometer(tx, ME, { shiftId: SHIFT, date: '2026-10-13', reading: '12045' });
      await tracking.openOdometer(tx, ME, { shiftId: other, date: '2026-10-13', reading: null });
    });
    expect(await tracking.odometersOn(ME, '2026-10-13')).toEqual([]);
    await db.transaction((tx) => tracking.closeOdometer(tx, ME, SHIFT, '12098.5', 'upload-1'));
    expect(await tracking.odometersOn(ME, '2026-10-13')).toEqual([
      {
        shiftId: SHIFT,
        date: '2026-10-13',
        open: '12045',
        close: '12098.5',
        closeUploadId: 'upload-1',
      },
    ]);
    expect(await tracking.odometersOn('tenant-a:someone-else', '2026-10-13')).toEqual([]);
    // Two months on, old readings are let go.
    await db.transaction((tx) =>
      tracking.openOdometer(tx, ME, { shiftId: 'later', date: '2026-12-20', reading: '13000' }),
    );
    expect(await tracking.odometer(ME, SHIFT)).toBeNull();
  });
});
