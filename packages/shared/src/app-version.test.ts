import { describe, expect, it } from 'vitest';
import { compareVersions, isBelowMinimum } from './app-version';

describe('app versions (M1, rule 8)', () => {
  it('compare part by part, as numbers', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
  });

  it('turn away only a readable version under the minimum', () => {
    expect(isBelowMinimum('1.4.9', '1.5.0')).toBe(true);
    expect(isBelowMinimum('1.5.0', '1.5.0')).toBe(false);
    expect(isBelowMinimum('1.6.0', '1.5.0')).toBe(false);
    expect(isBelowMinimum('1.0.0', undefined)).toBe(false);
    expect(isBelowMinimum('one', '1.5.0')).toBe(false);
  });
});
