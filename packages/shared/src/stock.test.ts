import { describe, expect, it } from 'vitest';
import {
  countResult,
  movementsFromFulfilment,
  onHandAfter,
  signedUnits,
  stockShortfall,
  stockUnits,
  stockUnitsText,
} from './stock';

describe('stock quantities (FX-89, BR-62)', () => {
  it('reads and writes signed base units exactly, to three places', () => {
    expect(stockUnits('-2.5')).toBe(-2500n);
    expect(stockUnitsText(100000n)).toBe('100');
    expect(stockUnitsText(-2500n)).toBe('-2.5');
    expect(stockUnitsText(0n)).toBe('0');
    expect(onHandAfter('10', '-12.25')).toBe('-2.25');
  });

  it('signs a movement by its kind, and leaves corrections as written', () => {
    expect(signedUnits('received', '24')).toBe('24');
    expect(signedUnits('sold', '24')).toBe('-24');
    expect(signedUnits('returned_out', '3')).toBe('-3');
    expect(signedUnits('returned_in', '3')).toBe('3');
    expect(signedUnits('corrected', '-1.5')).toBe('-1.5');
  });
});

describe('fulfilment moving stock (FX-90, FX-91, BR-62)', () => {
  const distributor = { accountId: 'dist', keepsStock: true };
  const retailer = { accountId: 'shop', keepsStock: false };

  it('brings a primary order’s fulfilled units into the distributor, once', () => {
    const line = { lineId: 'l1', itemId: 'neem', fulfilled: '24', movedIn: '0', movedOut: '0' };
    expect(movementsFromFulfilment({ buyer: distributor, supplier: null, lines: [line] })).toEqual([
      { accountId: 'dist', itemId: 'neem', kind: 'received', units: '24', lineId: 'l1' },
    ]);
    expect(
      movementsFromFulfilment({
        buyer: distributor,
        supplier: null,
        lines: [{ ...line, movedIn: '24' }],
      }),
    ).toEqual([]);
    expect(
      movementsFromFulfilment({
        buyer: distributor,
        supplier: null,
        lines: [{ ...line, movedIn: '10' }],
      }),
    ).toEqual([expect.objectContaining({ units: '14' })]);
  });

  it('takes a secondary order’s units out of its supplier, and into a buyer that keeps stock', () => {
    const line = { lineId: 'l2', itemId: 'neem', fulfilled: '6', movedIn: '0', movedOut: '0' };
    expect(
      movementsFromFulfilment({ buyer: retailer, supplier: distributor, lines: [line] }),
    ).toEqual([{ accountId: 'dist', itemId: 'neem', kind: 'sold', units: '-6', lineId: 'l2' }]);
    expect(
      movementsFromFulfilment({
        buyer: { ...retailer, keepsStock: true },
        supplier: distributor,
        lines: [line],
      }).map((movement) => [movement.accountId, movement.units]),
    ).toEqual([
      ['shop', '6'],
      ['dist', '-6'],
    ]);
    expect(
      movementsFromFulfilment({
        buyer: retailer,
        supplier: { ...distributor, keepsStock: false },
        lines: [line],
      }),
    ).toEqual([]);
  });
});

describe('a count against the ledger (FX-92, BR-62)', () => {
  it('adjusts by the difference and flags it past the tolerance', () => {
    expect(countResult('100', '96', 5)).toEqual({ difference: '-4', flags: [] });
    expect(countResult('100', '105', 5)).toEqual({ difference: '5', flags: [] });
    expect(countResult('100', '94', 5)).toEqual({ difference: '-6', flags: ['beyond_tolerance'] });
    expect(countResult('0', '3', 5)).toEqual({ difference: '3', flags: ['beyond_tolerance'] });
    expect(countResult('12', '12', 0)).toEqual({ difference: '0', flags: [] });
  });

  it('flags a ledger that had fallen below zero', () => {
    expect(countResult('-2', '0', 5)).toEqual({
      difference: '2',
      flags: ['beyond_tolerance', 'was_negative'],
    });
  });
});

describe('a cart against its supplier’s stock (FX-93, BR-62)', () => {
  it('sums an item’s lines, counts a missing or negative level as none, and names what is short', () => {
    const onHand = new Map([
      ['neem', '30'],
      ['urea', '-4'],
    ]);
    expect(
      stockShortfall(
        [
          { itemId: 'neem', baseUnits: '24' },
          { itemId: 'neem', baseUnits: '2' },
          { itemId: 'urea', baseUnits: '1' },
          { itemId: 'karanj', baseUnits: '12' },
        ],
        onHand,
      ),
    ).toEqual([
      { itemId: 'urea', ordered: '1', onHand: '-4', short: '1' },
      { itemId: 'karanj', ordered: '12', onHand: '0', short: '12' },
    ]);
    expect(stockShortfall([{ itemId: 'neem', baseUnits: '30' }], onHand)).toEqual([]);
  });
});
