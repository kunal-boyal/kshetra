import { describe, expect, it } from 'vitest';
import {
  ageingIssue,
  bucketsIssue,
  DEFAULT_AGEING_BUCKETS,
  entryIssue,
  financialYear,
  openingBalance,
  runningBalances,
} from './finance';

describe('account finance (spec 7.3)', () => {
  it('FX-15: running balances from the opening balance', () => {
    expect(
      runningBalances('1000.00', [
        { date: '2026-04-02', debit: '10000.00', credit: '0' },
        { date: '2026-04-03', debit: '0', credit: '3000.00' },
      ]),
    ).toEqual(['11000.00', '8000.00']);
    expect(runningBalances('-500', [{ date: '2026-04-02', debit: '0', credit: '100' }])).toEqual([
      '-600.00',
    ]);
  });

  it('BR-21: opens a year with every entry before it, and takes one of debit or credit', () => {
    const entries = [
      { date: '2026-03-30', debit: '1500.00', credit: '0' },
      { date: '2026-03-31', debit: '0', credit: '500.00' },
      { date: '2026-04-01', debit: '999.00', credit: '0' },
    ];
    expect(openingBalance(entries, '2026-04-01')).toBe('1000.00');
    expect(openingBalance(entries, '2026-03-01')).toBe('0.00');
    expect(entryIssue({ debit: '10', credit: '0' })).toBeNull();
    expect(entryIssue({ debit: '10', credit: '5' })).not.toBeNull();
    expect(entryIssue({ debit: '0', credit: '0.00' })).not.toBeNull();
  });

  it('FX-16: refuses buckets adding up to more than outstanding by over 0.01', () => {
    expect(ageingIssue('50000', { a: '20000', b: '20000', c: '10000.01' })).toBeNull();
    expect(ageingIssue('50000', { a: '20000', b: '20000', c: '10000.02' })).toBe(
      'The buckets add up to 50000.02, more than the outstanding 50000.00',
    );
  });

  it('BR-20: buckets follow one another without overlapping', () => {
    expect(bucketsIssue(DEFAULT_AGEING_BUCKETS)).toBeNull();
    expect(
      bucketsIssue([
        { key: 'a', fromDays: 0, toDays: 30 },
        { key: 'b', fromDays: 30, toDays: 60 },
      ]),
    ).toBe('b overlaps a');
    expect(
      bucketsIssue([
        { key: 'a', fromDays: 0, toDays: null },
        { key: 'b', fromDays: 31, toDays: 60 },
      ]),
    ).toBe('Only the last bucket may have no end, not a');
  });

  it('finds the financial year of a day', () => {
    expect(financialYear('2026-10-24', 4)).toEqual({
      from: '2026-04-01',
      to: '2027-03-31',
      startYear: 2026,
    });
    expect(financialYear('2027-02-01', 4).startYear).toBe(2026);
    expect(financialYear('2026-10-24', 1)).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
      startYear: 2026,
    });
  });
});
