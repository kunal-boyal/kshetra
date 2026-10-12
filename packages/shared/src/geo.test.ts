import { describe, expect, it } from 'vitest';
import { distanceMeters, geofenceRadius, proposalFix } from './geo';

describe('places', () => {
  it('measures distance along the surface', () => {
    // Connaught Place to India Gate, New Delhi: about 2.4 km.
    const distance = distanceMeters({ lat: 28.6315, lng: 77.2167 }, { lat: 28.6129, lng: 77.2295 });
    expect(distance).toBeGreaterThan(2_300);
    expect(distance).toBeLessThan(2_500);
    expect(distanceMeters({ lat: 10, lng: 20 }, { lat: 10, lng: 20 })).toBe(0);
  });

  it('takes a proposed location only from a fresh fix of 50 m or better (M4)', () => {
    // Judged when the person proposed it, so a proposal sent later from offline still counts.
    const now = new Date('2026-10-12T10:00:00Z');
    expect(proposalFix({ accuracy: 50, capturedAt: '2026-10-12T09:59:00Z' }, now)).toBe('ok');
    expect(proposalFix({ accuracy: 51, capturedAt: '2026-10-12T09:59:00Z' }, now)).toBe(
      'inaccurate',
    );
    expect(proposalFix({ accuracy: 20, capturedAt: '2026-10-12T09:57:59Z' }, now)).toBe('stale');
    expect(proposalFix({ accuracy: 20, capturedAt: '2026-10-12T10:01:00Z' }, now)).toBe('stale');
  });

  it("uses the account's radius, then its type's, then the tenant's", () => {
    expect(geofenceRadius(150, 300, 200)).toBe(150);
    expect(geofenceRadius(null, 300, 200)).toBe(300);
    expect(geofenceRadius(null, undefined, 200)).toBe(200);
  });
});
