import { describe, expect, it } from 'vitest';
import { decodePolyline, isStale, pathLengthMeters, positionAt } from './maps';
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
