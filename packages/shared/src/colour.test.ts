import { describe, expect, it } from 'vitest';
import { contrastRatio } from './colour';

describe('contrastRatio', () => {
  it('runs from 1 for the same colour to 21 for black on white', () => {
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it('passes the product accent and fails a pale yellow against white (spec 5.1)', () => {
    expect(contrastRatio('#5b2b82', '#ffffff')).toBeGreaterThan(9.9);
    expect(contrastRatio('#ffcc00', '#ffffff')).toBeLessThan(4.5);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});
