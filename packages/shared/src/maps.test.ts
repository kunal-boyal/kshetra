import { describe, expect, it } from 'vitest';
import { decodePolyline, isStale, offPlan, pathLengthMeters, positionAt } from './maps';
import { encodePolyline } from './tracking';

describe('maps (M17)', () => {
  it('decodes what the trail encodes', () => {
    const points = [
      { lat: 28.6315, lng: 77.2167 },
      { lat: 28.632, lng: 77.218 },
      { lat: 28.62, lng: 77.2 },
    ];
    expect(decodePolyline(encodePolyline(points))).toEqual(points);
    // Google's own example.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
    expect(decodePolyline('')).toEqual([]);
  });

  it('measures a path along the Earth', () => {
    const metres = pathLengthMeters([
      { lat: 28.6, lng: 77.2 },
      { lat: 28.61, lng: 77.2 },
    ]);
    expect(Math.round(metres)).toBe(1112);
    expect(pathLengthMeters([{ lat: 1, lng: 1 }])).toBe(0);
  });

  it('places a replay between fixes in proportion to the time', () => {
    const route = [
      { lat: 28.6, lng: 77.2, at: 0 },
      { lat: 28.7, lng: 77.4, at: 1000 },
    ];
    const middle = positionAt(route, 500)!;
    expect(middle.lat).toBeCloseTo(28.65, 5);
    expect(middle.lng).toBeCloseTo(77.3, 5);
    expect(positionAt(route, -10)).toEqual({ lat: 28.6, lng: 77.2 });
    expect(positionAt(route, 5000)).toEqual({ lat: 28.7, lng: 77.4 });
    expect(positionAt([], 1)).toBeNull();
  });

  it('flags a position older than 15 minutes', () => {
    const now = new Date('2026-10-21T10:00:00Z');
    expect(isStale('2026-10-21T09:46:00Z', now)).toBe(false);
    expect(isStale('2026-10-21T09:44:59Z', now)).toBe(true);
  });
});

describe('off the plan (decision D104)', () => {
  const shop = { lat: 28.6315, lng: 77.2167 };
  // About 1.1 km north for each 0.01 degree.
  const north = (km: number) => ({ lat: shop.lat + km / 111.32, lng: shop.lng });

  it('is off only when farther than ten radii from every planned account', () => {
    expect(offPlan(north(0.9), [shop], 100)).toBe(false);
    expect(offPlan(north(1.1), [shop], 100)).toBe(true);
    expect(offPlan(north(1.1), [shop, north(1.5)], 100)).toBe(false);
  });

  it('is never off without a position or a located plan', () => {
    expect(offPlan(null, [shop], 100)).toBe(false);
    expect(offPlan(north(50), [], 100)).toBe(false);
  });
});
