import { describe, expect, it } from 'vitest';
import { cancellable, gstHalves, statusAfterFulfilment, statusFromLines } from './orders';

describe('orders (BR-19)', () => {
  it('FX-14: derives the status from line decisions', () => {
    expect(statusFromLines(['accepted', 'rejected'])).toBe('partially_accepted');
    expect(statusFromLines(['accepted', 'pending'])).toBe('accepted');
    expect(statusFromLines(['rejected', 'rejected'])).toBe('rejected');
  });

  it('moves accepted orders through fulfilment, and nothing else', () => {
    const lines = (fulfilled: string[]) =>
      fulfilled.map((units) => ({ ordered: '24.000', fulfilled: units }));
    expect(statusAfterFulfilment('accepted', lines(['0', '0']))).toBe('accepted');
    expect(statusAfterFulfilment('accepted', lines(['24', '12']))).toBe('partially_fulfilled');
    expect(statusAfterFulfilment('partially_fulfilled', lines(['24', '24.000']))).toBe('fulfilled');
    expect(statusAfterFulfilment('submitted', lines(['24', '24']))).toBeNull();
    expect(statusAfterFulfilment('fulfilled', lines(['24', '24']))).toBeNull();
    expect(cancellable('accepted')).toBe(true);
    expect(cancellable('partially_fulfilled')).toBe(false);
  });

  it('splits GST into halves that add up to the tax', () => {
    expect(gstHalves('1555.20')).toEqual({ cgst: '777.60', sgst: '777.60' });
    expect(gstHalves('584.69')).toEqual({ cgst: '292.35', sgst: '292.34' });
    expect(gstHalves('0.00')).toEqual({ cgst: '0.00', sgst: '0.00' });
  });
});
