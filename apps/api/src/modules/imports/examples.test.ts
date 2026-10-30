import { METRIC_UNITS, targetValueIssue } from '@thelamp/shared';
import { describe, expect, it } from 'vitest';
import { exampleFigure } from './examples';

describe('example figures (D111)', () => {
  it('are values a target of each unit takes', () => {
    for (const unit of METRIC_UNITS) {
      for (const second of [false, true]) {
        expect(targetValueIssue(unit, exampleFigure(unit, second)), unit).toBeNull();
      }
    }
    expect(Number(exampleFigure('percent', true))).toBeLessThanOrEqual(100);
  });
});
