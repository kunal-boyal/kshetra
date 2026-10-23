import { describe, expect, it } from '@jest/globals';
import { mapsAvailable } from './maps';

describe('maps without a key (decision D68)', () => {
  it("draws Google's maps on Android only when the build has a Maps key", () => {
    expect(mapsAvailable('android', { mapsKey: true })).toBe(true);
    expect(mapsAvailable('android', { mapsKey: false })).toBe(false);
    // A config that doesn't say keeps the map, as builds before this did.
    expect(mapsAvailable('android', undefined)).toBe(true);
    expect(mapsAvailable('ios', { mapsKey: false })).toBe(true);
  });
});
