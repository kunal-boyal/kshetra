import { describe, expect, it } from 'vitest';
import {
  anomalyFlags,
  burst,
  fastTravel,
  mockHistory,
  photoFar,
  type PlacedRecord,
} from './anomalies';

const MIN = 60_000;
const DAY = 86_400_000;
const T = Date.parse('2026-11-01T06:00:00Z');
/** About 111 m a thousandth of a degree of latitude. */
const HERE = { lat: 28.6, lng: 77.2 };
const north = (metres: number) => ({ lat: HERE.lat + metres / 111_195, lng: HERE.lng });
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const placed = (
  n: number,
  at: number,
  point = HERE,
  accountId: string | null = null,
  kind: PlacedRecord['kind'] = 'submission',
): PlacedRecord => ({ kind, id: id(n), at, point, accountId });

describe('BR-50: a photo far from its record', () => {
  const record = { point: HERE, accuracy: 20 };
  it('flags a photo over 150 m beyond both accuracies, each counting up to 100 m', () => {
    // 20 + 20 of accuracy: 189 m is within the 190 m line, 192 m beyond it.
    expect(photoFar([{ id: id(1), point: north(189), accuracy: 20 }], record)).toBeNull();
    expect(photoFar([{ id: id(1), point: north(192), accuracy: 20 }], record)).toEqual({
      photoId: id(1),
      distanceM: 192,
    });
    // A vague photo counts only 100 m of its accuracy.
    expect(photoFar([{ id: id(1), point: north(280), accuracy: 400 }], record)).not.toBeNull();
    expect(photoFar([{ id: id(1), point: north(260), accuracy: 400 }], record)).toBeNull();
  });

  it('names the farthest, and leaves photos without a place unmeasured', () => {
    expect(
      photoFar(
        [
          { id: id(1), point: north(300), accuracy: 5 },
          { id: id(2), point: north(450), accuracy: 5 },
          { id: id(3), point: null, accuracy: null },
        ],
        record,
      ),
    ).toEqual({ photoId: id(2), distanceM: 450 });
  });
});

describe('BR-50: travel faster than the road allows', () => {
  it('flags 5 km or more covered faster than 100 km/h, in a straight line', () => {
    const here = placed(1, T);
    // 10 km in 5 minutes is 120 km/h; in 7 minutes, under 86 km/h.
    expect(fastTravel(here, [placed(2, T + 5 * MIN, north(10_000))])).toEqual([
      expect.objectContaining({
        note: {
          otherKind: 'submission',
          otherId: id(2),
          otherAt: new Date(T + 5 * MIN).toISOString(),
          distanceM: 10_000,
          seconds: 300,
        },
      }),
    ]);
    expect(fastTravel(here, [placed(2, T + 7 * MIN, north(10_000))])).toEqual([]);
  });

  it('never counts records under 5 km apart, however close in time', () => {
    expect(fastTravel(placed(1, T), [placed(2, T, north(4_900))])).toEqual([]);
    expect(fastTravel(placed(1, T), [placed(2, T, north(5_000))])).toHaveLength(1);
  });

  it('looks both ways in time, nearest first, and never at itself', () => {
    const here = placed(1, T);
    const found = fastTravel(here, [
      here,
      placed(2, T - 4 * MIN, north(20_000), null, 'check_in'),
      placed(3, T + 2 * MIN, north(-20_000)),
    ]);
    expect(found.map((pair) => pair.other.id)).toEqual([id(3), id(2)]);
  });
});

describe('BR-50: many records in minutes at different places', () => {
  it('flags three records within 10 minutes at three places', () => {
    const found = burst(placed(1, T), [
      placed(2, T + 3 * MIN, north(400)),
      placed(3, T + 9 * MIN, north(800)),
    ]);
    expect(found?.note).toEqual({ places: 3, seconds: 540 });
    expect(found?.members.map((member) => member.id)).toEqual([id(2), id(3)]);
  });

  it('needs them within one 10 minute window', () => {
    expect(
      burst(placed(1, T), [placed(2, T - 6 * MIN, north(400)), placed(3, T + 6 * MIN, north(800))]),
    ).toBeNull();
  });

  it('counts records at one account, or within 300 m, as one place', () => {
    const shop = id(90);
    expect(
      burst(placed(1, T, HERE, shop), [
        placed(2, T + MIN, north(2_000), shop),
        placed(3, T + 2 * MIN, north(400), shop),
      ]),
    ).toBeNull();
    expect(
      burst(placed(1, T), [placed(2, T + MIN, north(250)), placed(3, T + 2 * MIN, north(500))]),
    ).toBeNull();
    // Different accounts are different places, however close.
    expect(
      burst(placed(1, T, HERE, id(91)), [
        placed(2, T + MIN, HERE, id(92)),
        placed(3, T + 2 * MIN, HERE, id(93)),
      ])?.note.places,
    ).toBe(3);
  });
});

describe('BR-50: mocked locations', () => {
  it('flags a record within 30 days after a mocked fix was refused', () => {
    const report = { seenAt: T - 30 * DAY, source: 'form' as const };
    expect(mockHistory(T, report, [])).toEqual({
      source: 'form',
      lastSeenAt: new Date(T - 30 * DAY).toISOString(),
    });
    expect(mockHistory(T + 1, report, [])).toBeNull();
    expect(mockHistory(T, { seenAt: T + MIN, source: 'form' }, [])).toBeNull();
  });

  it('flags a photo with a mocked fix of its own', () => {
    expect(mockHistory(T, null, [{ mocked: true }])).toEqual({ source: 'photo', lastSeenAt: null });
    expect(mockHistory(T, null, [{ mocked: false }, { mocked: null }])).toBeNull();
  });
});

describe('BR-50: a submission’s flags', () => {
  const input = {
    record: { ...placed(1, T), accuracy: 10 },
    others: [
      placed(2, T + 2 * MIN, north(20_000), null, 'punch_in'),
      placed(3, T + 4 * MIN, north(900)),
    ],
    photos: [{ id: id(5), point: north(400), accuracy: 10, mocked: true }],
    onShift: false,
    lastMockReport: null,
  };

  it('gives every flag that applies, with notes that hold no place', () => {
    const found = anomalyFlags(input, []);
    expect(found.flags).toEqual(['photo_far', 'fast_travel', 'burst', 'off_shift', 'mock_history']);
    expect(found.fastWith.map((pair) => pair.other.id)).toEqual([id(2)]);
    expect(found.burstWith.map((record) => record.id)).toEqual([id(2), id(3)]);
    const text = JSON.stringify(found.notes);
    expect(text).not.toContain('lat');
    expect(text).not.toContain(String(HERE.lng));
  });

  it('leaves out what the tenant switched off', () => {
    const found = anomalyFlags(input, ['fast_travel', 'off_shift']);
    expect(found.flags).toEqual(['photo_far', 'burst', 'mock_history']);
    expect(found.notes.fast_travel).toBeUndefined();
    expect(found.fastWith).toEqual([]);
  });

  it('gives nothing for an ordinary record', () => {
    expect(
      anomalyFlags({ ...input, others: [], photos: [], onShift: true, lastMockReport: null }, []),
    ).toEqual({ flags: [], notes: {}, fastWith: [], burstWith: [] });
  });
});
