import { describe, expect, it } from 'vitest';
import {
  forecastAccuracy,
  forecastAfterLock,
  forecastGap,
  forecastMonths,
  forecastOpen,
} from './forecasts';

describe('BR-54: forecasts per account', () => {
  it('FX-52: forecasts the three months after today’s, across a year’s end', () => {
    expect(forecastMonths('2026-12-14')).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(forecastMonths('2026-11-01')).toEqual(['2026-12', '2027-01', '2027-02']);
  });

  it('FX-53: locks a month on its 1st, after which only the override changes it', () => {
    expect(forecastOpen('2026-12', '2026-11-30', false)).toBe(true);
    expect(forecastOpen('2026-12', '2026-12-01', false)).toBe(false);
    expect(forecastOpen('2026-12', '2026-12-01', true)).toBe(true);
    expect(forecastAfterLock('2026-12', '2026-11-30')).toBe(false);
    expect(forecastAfterLock('2026-12', '2026-12-01')).toBe(true);
  });

  it('FX-54: weighs accuracy by quantity, misses both ways, and says nothing without a forecast', () => {
    // Forecast 100 and 50; 90 and 70 came: missed 10 + 20 of 150.
    expect(
      forecastAccuracy([
        { forecast: '100', actual: '90' },
        { forecast: '50', actual: '70' },
      ]),
    ).toBe(0.8);
    // An item ordered but never forecast counts as a miss.
    expect(
      forecastAccuracy([
        { forecast: '100', actual: '100' },
        { forecast: '0', actual: '25' },
      ]),
    ).toBe(0.75);
    expect(forecastAccuracy([{ forecast: '10', actual: '40' }])).toBe(0);
    expect(forecastAccuracy([{ forecast: '0', actual: '5' }])).toBeNull();
    expect(forecastAccuracy([])).toBeNull();
  });

  it('measures the gap as a quantity and a share', () => {
    expect(forecastGap('100', '90')).toEqual({ quantity: '-10.000', share: -0.1 });
    expect(forecastGap('0', '25.5')).toEqual({ quantity: '25.500', share: null });
  });
});
