import { describe, expect, it } from 'vitest';
import {
  creditedDate,
  lineValue,
  monthEnd,
  soldThrough,
  statementLineFlags,
  statementOpen,
} from './sell-through';

const line = (opening: string, received: string, returned: string, closing: string) => ({
  opening,
  received,
  returned,
  closing,
});

describe('BR-53: sell-through by item', () => {
  it('FX-49: carries last month’s closing forward and works out what sold through', () => {
    // October closed with 40; November received 100, returned 5 and closes with 60.
    const november = line('40', '100', '5', '60');
    expect(soldThrough(november)).toBe('75.000');
    expect(statementLineFlags(november, '40')).toEqual([]);
    // An opening typed over the carried closing is kept, and flagged.
    expect(statementLineFlags(line('45', '100', '5', '60'), '40')).toEqual(['opening_changed']);
    // Part units, exactly.
    expect(soldThrough(line('2.5', '10.125', '0', '3.25'))).toBe('9.375');
    expect(lineValue('9.375', '120.40')).toBe('1128.75');
  });

  it('FX-50: a closing above what the stock explains is negative, flagged, never refused', () => {
    const odd = line('10', '0', '0', '14');
    expect(soldThrough(odd)).toBe('-4.000');
    expect(statementLineFlags(odd, null)).toEqual(['negative_sold']);
    expect(lineValue('-4.000', '99.99')).toBe('-399.96');
    expect(lineValue('-4.000', null)).toBeNull();
  });

  it('FX-51: a change in the next month’s first days counts on the month’s last day', () => {
    expect(statementOpen('2026-10', '2026-10-01')).toBe(true);
    expect(statementOpen('2026-10', '2026-11-05')).toBe(true);
    expect(statementOpen('2026-10', '2026-11-06')).toBe(false);
    expect(statementOpen('2026-11', '2026-10-31')).toBe(false);
    expect(creditedDate('2026-10', '2026-10-17')).toBe('2026-10-17');
    expect(creditedDate('2026-10', '2026-11-03')).toBe('2026-10-31');
  });

  it('knows months’ ends', () => {
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
  });
});
