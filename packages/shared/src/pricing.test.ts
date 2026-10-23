import { describe, expect, it } from 'vitest';
import {
  applicableLists,
  baseUnits,
  expectedPriceIssue,
  finalRate,
  measureOf,
  netRate,
  orderSizeIssue,
  orderTotals,
  type PriceListRef,
  priceFor,
  priceLine,
  quoteDifferences,
  scaled,
  unscaled,
} from './pricing';

describe('decimals', () => {
  it('reads and writes exactly, refusing what it cannot hold', () => {
    expect(scaled('400', 2)).toBe(40000n);
    expect(scaled('0.1', 4)).toBe(1000n);
    expect(scaled('12.500', 2)).toBe(1250n);
    expect(unscaled(5n, 3)).toBe('0.005');
    expect(unscaled(1255520n, 2)).toBe('12555.20');
    expect(() => scaled('1.005', 2)).toThrow();
    expect(() => scaled('-1', 2)).toThrow();
  });
});

describe('pricing (Appendix D)', () => {
  it('FX-07: prices a line in cases from a per-pack price with discount and tax', () => {
    const line = priceLine({
      price: '400.00',
      discount: '10',
      taxRate: '18',
      quantity: '2',
      factor: '12',
    });
    expect(line).toEqual({
      rate: '360.00',
      baseUnits: '24.000',
      taxable: '8640.00',
      tax: '1555.20',
      total: '10195.20',
      measure: null,
    });
  });

  it('FX-08: rounds the tax and adds the rounded values', () => {
    const line = priceLine({
      price: '90.23',
      discount: '0',
      taxRate: '18',
      quantity: '3',
      factor: '12',
    });
    expect(line).toMatchObject({ taxable: '3248.28', tax: '584.69', total: '3832.97' });
    expect(orderTotals([line, line])).toEqual({
      taxable: '6496.56',
      tax: '1169.38',
      total: '7665.94',
    });
  });

  it('FX-09: rounds the net rate before multiplying by the quantity', () => {
    expect(netRate('99.99', '12.5')).toBe('87.49');
    const line = priceLine({
      price: '99.99',
      discount: '12.5',
      taxRate: '0',
      quantity: '100',
      factor: '1',
    });
    expect(line.taxable).toBe('8749.00');
    // Rounding at the end keeps the fraction: 87.49125 × 100.
    expect(
      priceLine(
        { price: '99.99', discount: '12.5', taxRate: '0', quantity: '100', factor: '1' },
        'end',
      ).taxable,
    ).toBe('8749.13');
  });

  it('FX-10: counts base units and litres', () => {
    expect(baseUnits('5', '12')).toBe('60.000');
    expect(measureOf('60', '0.5')).toBe('30.000');
    const line = priceLine({
      price: '10',
      discount: '0',
      taxRate: '0',
      quantity: '5',
      factor: '12',
      measurePerBaseUnit: '0.5',
    });
    expect(line.measure).toBe('30.000');
  });

  it('rounds half up', () => {
    expect(netRate('0.05', '50')).toBe('0.03');
    expect(finalRate('100.00', '2.5')).toBe('102.50');
    expect(netRate('1.01', '50')).toBe('0.51');
  });

  it('BR-13: refuses too many lines, a repeated item and a total over the limit', () => {
    const line = (itemId: string, total = '1.00') => ({ itemId, total });
    expect(orderSizeIssue([line('a'), line('b')])).toBeNull();
    expect(orderSizeIssue([line('a'), line('a')])).toBe('repeated_item');
    expect(orderSizeIssue(Array.from({ length: 201 }, (_, i) => line(String(i))))).toBe(
      'too_many_lines',
    );
    expect(orderSizeIssue([line('a', '10000000000.00')])).toBeNull();
    expect(orderSizeIssue([line('a', '10000000000.00'), line('b', '0.01')])).toBe('too_large');
  });

  it('BR-17: checks expected net and final prices within 0.02', () => {
    const entry = { price: '400', discount: '10', taxRate: '18' };
    expect(expectedPriceIssue(entry, { net: '360.02', final: '424.80' })).toBeNull();
    expect(expectedPriceIssue(entry, { net: '360.03' })).toEqual({
      field: 'net',
      computed: '360.00',
    });
    expect(expectedPriceIssue(entry, { final: '425' })).toEqual({
      field: 'final',
      computed: '424.80',
    });
    expect(expectedPriceIssue(entry, {})).toBeNull();
  });

  it('FX-13: tells which quoted parts differ from the price list now', () => {
    const quoted = { price: '400.00', discount: '10', taxRate: '18', factor: '12' };
    expect(quoteDifferences(quoted, { ...quoted, discount: '10.0000' })).toEqual([]);
    expect(quoteDifferences(quoted, { ...quoted, discount: '12' })).toEqual(['discount']);
    expect(quoteDifferences(quoted, { ...quoted, price: '410', factor: '10' })).toEqual([
      'price',
      'factor',
    ]);
  });
});

describe('which price list applies (spec 5.11)', () => {
  const list = (id: string, overrides: Partial<PriceListRef> = {}): PriceListRef => ({
    id,
    scope: 'default',
    targets: [],
    priority: 0,
    validFrom: '2026-01-01',
    validTo: null,
    active: true,
    ...overrides,
  });
  const account = {
    id: 'acc-1',
    type: 'distributor',
    segments: ['commercially_active'],
    territories: ['market', 'zone', 'country'],
  };
  const DAY = '2026-10-24';

  it('puts the most specific list first: account, nearer territory, segment, type, default', () => {
    const lists = [
      list('default'),
      list('type', { scope: 'account_type', targets: ['distributor'] }),
      list('segment', { scope: 'segment', targets: ['commercially_active'] }),
      list('zone', { scope: 'territory', targets: ['zone'] }),
      list('market', { scope: 'territory', targets: ['market'] }),
      list('mine', { scope: 'account', targets: ['acc-1'] }),
      list('other', { scope: 'account', targets: ['acc-2'] }),
      list('retail', { scope: 'account_type', targets: ['retailer'] }),
    ];
    expect(applicableLists(lists, account, DAY).map((entry) => entry.id)).toEqual([
      'mine',
      'market',
      'zone',
      'segment',
      'type',
      'default',
    ]);
  });

  it('keeps lists valid on the day and active; ties go to priority, then the later start', () => {
    const lists = [
      list('old', { validTo: '2026-09-30' }),
      list('later', { validFrom: '2026-11-01' }),
      list('off', { active: false }),
      list('low', { priority: 1 }),
      list('high', { priority: 5 }),
      list('high-newer', { priority: 5, validFrom: '2026-10-01' }),
      list('edge', { validFrom: DAY, validTo: DAY, priority: -1 }),
    ];
    expect(applicableLists(lists, account, DAY).map((entry) => entry.id)).toEqual([
      'high-newer',
      'high',
      'low',
      'edge',
    ]);
  });

  it('prices an item from the first list that has it', () => {
    const lists = [list('mine', { scope: 'account', targets: ['acc-1'] }), list('default')];
    const entries: Record<string, Record<string, { price: string; discount: string }>> = {
      mine: { a: { price: '90', discount: '0' } },
      default: { a: { price: '100', discount: '0' }, b: { price: '50', discount: '5' } },
    };
    const lookup = (listId: string, itemId: string) => entries[listId]?.[itemId];
    expect(priceFor('a', lists, lookup)).toEqual({ price: '90', discount: '0', listId: 'mine' });
    expect(priceFor('b', lists, lookup)).toEqual({ price: '50', discount: '5', listId: 'default' });
    expect(priceFor('c', lists, lookup)).toBeNull();
  });
});
