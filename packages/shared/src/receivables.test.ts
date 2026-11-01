import { describe, expect, it } from 'vitest';
import { DEFAULT_AGEING_BUCKETS } from './finance';
import {
  invoiceAgeing,
  invoiceDueDate,
  type RegisterInvoice,
  type RegisterReceipt,
  settleInvoices,
} from './receivables';

const invoice = (
  number: string,
  date: string,
  amount: string,
  overrides: Partial<RegisterInvoice> = {},
): RegisterInvoice => ({
  number,
  date,
  dueDate: invoiceDueDate(date, 30),
  amount,
  cancelled: false,
  ...overrides,
});
const receipt = (
  number: string,
  date: string,
  amount: string,
  against: string[] = [],
  cancelled = false,
): RegisterReceipt => ({ number, date, amount, against, cancelled });

describe('BR-51: invoices and receipts', () => {
  it('works out a due date from credit days', () => {
    expect(invoiceDueDate('2026-10-15', 30)).toBe('2026-11-14');
    expect(invoiceDueDate('2026-02-28', 1)).toBe('2026-03-01');
    expect(invoiceDueDate('2026-10-15', 0)).toBe('2026-10-15');
  });

  it('FX-42: a receipt settles the invoices it names, then the oldest open ones', () => {
    const invoices = [
      invoice('INV-1', '2026-08-01', '10000'),
      invoice('INV-2', '2026-09-01', '5000'),
      invoice('INV-3', '2026-10-01', '8000'),
    ];
    const settled = settleInvoices(invoices, [receipt('R-1', '2026-10-10', '9000', ['INV-3'])]);
    // 8,000 to INV-3 as named; the 1,000 left to the oldest, INV-1.
    expect(settled.settlements).toEqual([
      { receipt: 'R-1', invoice: 'INV-3', amount: '8000.00' },
      { receipt: 'R-1', invoice: 'INV-1', amount: '1000.00' },
    ]);
    expect(Object.fromEntries(settled.open)).toEqual({
      'INV-1': '9000.00',
      'INV-2': '5000.00',
      'INV-3': '0.00',
    });
    expect(settled.advance).toBe('0.00');
  });

  it('FX-43: without names, receipts settle oldest first, by due date', () => {
    const invoices = [
      invoice('INV-2', '2026-09-01', '5000'),
      invoice('INV-1', '2026-08-01', '10000', { dueDate: '2026-08-15' }),
    ];
    const settled = settleInvoices(invoices, [
      receipt('R-1', '2026-09-10', '12000.50'),
      receipt('R-0', '2026-08-20', '0.50'),
    ]);
    expect(Object.fromEntries(settled.open)).toEqual({ 'INV-1': '0.00', 'INV-2': '2999.00' });
  });

  it('FX-44: receipts beyond every invoice are an advance, and outstanding goes below zero', () => {
    const invoices = [invoice('INV-1', '2026-10-01', '1000')];
    const settled = settleInvoices(invoices, [
      receipt('R-1', '2026-10-05', '1500', ['INV-1', 'INV-9']),
    ]);
    expect(settled.advance).toBe('500.00');
    expect(invoiceAgeing(invoices, settled, DEFAULT_AGEING_BUCKETS, '2026-10-20')).toMatchObject({
      outstanding: '-500.00',
      notDue: '0.00',
      advance: '500.00',
    });
  });

  it('FX-45: a cancelled invoice leaves the ageing, and what named it goes oldest first', () => {
    const invoices = [
      invoice('INV-1', '2026-08-01', '4000'),
      invoice('INV-2', '2026-09-01', '6000', { cancelled: true }),
    ];
    const settled = settleInvoices(invoices, [
      receipt('R-1', '2026-09-15', '3000', ['INV-2']),
      receipt('R-2', '2026-09-20', '999', [], true),
    ]);
    expect(Object.fromEntries(settled.open)).toEqual({ 'INV-1': '1000.00' });
    expect(settled.settlements).toEqual([{ receipt: 'R-1', invoice: 'INV-1', amount: '3000.00' }]);
  });

  it('ages open invoices by days past due, with what is not due apart', () => {
    const invoices = [
      invoice('A', '2026-06-01', '100', { dueDate: '2026-06-01' }), // 152 days late
      invoice('B', '2026-09-01', '200', { dueDate: '2026-10-01' }), // 31 days late
      invoice('C', '2026-10-01', '300', { dueDate: '2026-11-01' }), // due today: 0 days late
      invoice('D', '2026-10-20', '400', { dueDate: '2026-11-19' }), // not yet due
    ];
    const ages = invoiceAgeing(
      invoices,
      settleInvoices(invoices, []),
      DEFAULT_AGEING_BUCKETS,
      '2026-11-01',
    );
    expect(ages).toEqual({
      outstanding: '1000.00',
      notDue: '400.00',
      overdue: '600.00',
      ageing: {
        d0_30: '300.00',
        d31_60: '200.00',
        d61_90: '0.00',
        d91_180: '100.00',
        d181: '0.00',
      },
      oldestDue: '2026-06-01',
      advance: '0.00',
    });
  });
});
