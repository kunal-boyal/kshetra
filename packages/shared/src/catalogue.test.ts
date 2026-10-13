import { describe, expect, it } from 'vitest';
import { packMeasure, packMeasureIssue, percentFromCell } from './catalogue';

describe('catalogue (spec 5.11, BR-16)', () => {
  it('reads the measure a pack label states', () => {
    expect(packMeasure('500 ML')).toEqual({ type: 'L', amount: 0.5 });
    expect(packMeasure('1 KG')).toEqual({ type: 'kg', amount: 1 });
    expect(packMeasure('250g pouch')).toEqual({ type: 'kg', amount: 0.25 });
    expect(packMeasure('Box of 10')).toBeNull();
  });

  it('FX-11: "500 ML" agrees with 0.5 L a unit, not 0.4 L', () => {
    expect(packMeasureIssue('500 ML', { type: 'L', perBaseUnit: 0.5 })).toBeNull();
    expect(packMeasureIssue('500 ML', { type: 'L', perBaseUnit: 0.4 })).toBe(
      'The pack label says 0.5 L a unit, but the measure is 0.4',
    );
    expect(packMeasureIssue('500 ML', { type: 'kg', perBaseUnit: 0.5 })).toBe(
      'The pack label says L, but the measure is in kg',
    );
    expect(packMeasureIssue('Box of 10', { type: 'kg', perBaseUnit: 3 })).toBeNull();
  });

  it('BR-17: reads a marked percentage of 1 or less as a fraction, exactly', () => {
    expect(percentFromCell('0.18', true)).toBe('18.0000');
    expect(percentFromCell('0.075', true)).toBe('7.5000');
    expect(percentFromCell('1', true)).toBe('100.0000');
    expect(percentFromCell('0.123456', true)).toBe('12.3456');
    expect(percentFromCell('18', true)).toBe('18.0000');
    expect(percentFromCell('0.5', false)).toBe('0.5000');
    expect(percentFromCell('12.5', false)).toBe('12.5000');
    expect(percentFromCell('12.34567', false)).toBeNull();
    expect(percentFromCell('18%', false)).toBeNull();
    expect(percentFromCell('', false)).toBeNull();
  });
});
