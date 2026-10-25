import { describe, expect, it } from 'vitest';
import {
  addMonths,
  annualTerm,
  dunning,
  dunningNotices,
  gstinIssue,
  gstOn,
  invoiceNumber,
  invoiceSeries,
  licenceState,
  lineAmount,
  sumAmounts,
  termQuarters,
  trueUp,
} from './invoicing';

// Fictional GSTINs whose check characters are right.
const MAHARASHTRA = '27ZZZZZ0000Z1ZQ';
const KARNATAKA = '29ZZZZZ0001Z1ZL';

describe('GSTINs', () => {
  it('accepts a well-formed GSTIN and says what is wrong with others', () => {
    expect(gstinIssue(MAHARASHTRA)).toBeNull();
    expect(gstinIssue(MAHARASHTRA, '27')).toBeNull();
    expect(gstinIssue(KARNATAKA, '27')).toBe('The GSTIN is for another state');
    expect(gstinIssue('27ZZZZZ0000Z1ZA')).toBe('Check the GSTIN for a typing error');
    expect(gstinIssue('27zzzzz0000z1zq')).toBe('Enter the 15-character GSTIN');
    expect(gstinIssue('99ZZZZZ0000Z1ZQ')).toBe(
      'The GSTIN starts with a state code that does not exist',
    );
  });
});

describe('invoice amounts (BR-47)', () => {
  it('prices seats to the paisa, rounding half up', () => {
    // FX-35's month: 2.5 seats at ₹499.
    expect(lineAmount('2.5000', '499.00')).toBe('1247.50');
    expect(lineAmount('11.4839', '499.00')).toBe('5730.47');
    expect(lineAmount('0.0001', '0.50')).toBe('0.00');
    expect(sumAmounts(['1247.50', '0.25', '10'])).toBe('1257.75');
  });

  it('FX-38: charges CGST and SGST within the seller’s state, IGST across states', () => {
    expect(gstOn('10000.00', '18', '27', '27')).toEqual({
      cgst: '900.00',
      sgst: '900.00',
      igst: '0.00',
      tax: '1800.00',
      total: '11800.00',
    });
    expect(gstOn('10000.00', '18', '27', '29')).toEqual({
      cgst: '0.00',
      sgst: '0.00',
      igst: '1800.00',
      tax: '1800.00',
      total: '11800.00',
    });
    // Each half rounds on its own: 9% of 1247.50 is 112.275.
    expect(gstOn('1247.50', '18', '27', '27')).toMatchObject({
      cgst: '112.28',
      sgst: '112.28',
      total: '1472.06',
    });
    // A buyer with no state is supplied across states.
    expect(gstOn('1247.50', '18', '27', null)).toMatchObject({ igst: '224.55' });
  });

  it('numbers invoices in one series a financial year, April to March', () => {
    expect(invoiceSeries('TL', '2026-10-04')).toBe('TL/26-27');
    expect(invoiceSeries('TL', '2027-03-31')).toBe('TL/26-27');
    expect(invoiceSeries('TL', '2027-04-01')).toBe('TL/27-28');
    expect(invoiceNumber('TL/26-27', 42)).toBe('TL/26-27/00042');
    expect(invoiceNumber('ABCD/26-27', 99999)).toHaveLength(16);
  });
});

describe('annual terms and true-ups (BR-47)', () => {
  it('runs a term twelve months and splits it into quarters', () => {
    expect(annualTerm('2026-11-15')).toEqual({ from: '2026-11-15', to: '2027-11-14' });
    expect(termQuarters('2026-11-15').map((q) => [q.from, q.to])).toEqual([
      ['2026-11-15', '2027-02-14'],
      ['2027-02-15', '2027-05-14'],
      ['2027-05-15', '2027-08-14'],
      ['2027-08-15', '2027-11-14'],
    ]);
    // A month-end start keeps to each month's last day.
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
  });

  it('FX-39: bills seats above the commitment from the quarter’s start to the term’s end', () => {
    // 10 committed at ₹12,000 a year; 13 people active in the second quarter.
    expect(trueUp({ committed: 10, seats: 13, priceYear: '12000.00', quarter: 2 })).toEqual({
      extra: 3,
      months: 9,
      rate: '9000.00',
      amount: '27000.00',
    });
    expect(trueUp({ committed: 13, seats: 12, priceYear: '12000.00', quarter: 3 })).toEqual({
      extra: 0,
      months: 6,
      rate: '6000.00',
      amount: '0.00',
    });
    // A quarter of ₹1,999.99 is ₹499.9975: the seat's rate rounds first, then multiplies.
    expect(trueUp({ committed: 13, seats: 15, priceYear: '1999.99', quarter: 4 })).toMatchObject({
      rate: '500.00',
      amount: '1000.00',
    });
  });
});

describe('dunning (BR-48)', () => {
  it('FX-40: grace for 7 days, read only for 14, then suspension', () => {
    const at = (today: string) =>
      dunning({ overdueSince: '2026-11-04', today, graceDays: 7, readOnlyDays: 14 });
    expect(at('2026-11-04')).toEqual({
      status: 'grace',
      readOnlyOn: '2026-11-11',
      suspendOn: '2026-11-25',
    });
    expect(at('2026-11-10').status).toBe('grace');
    expect(at('2026-11-11').status).toBe('read_only');
    expect(at('2026-11-24').status).toBe('read_only');
    expect(at('2026-11-25').status).toBe('suspended');
  });

  it('sends each notice once, on its day', () => {
    expect(dunningNotices(7, 14)).toEqual([
      { key: 'overdue', notice: 'payment_overdue', day: 0 },
      { key: 'reminder_3', notice: 'payment_reminder', day: 3 },
      { key: 'reminder_6', notice: 'payment_reminder', day: 6 },
      { key: 'read_only', notice: 'read_only', day: 7 },
      { key: 'suspension_soon', notice: 'suspension_soon', day: 18 },
      { key: 'suspended', notice: 'suspended', day: 21 },
    ]);
    // Short periods drop the reminders that would fall outside them.
    expect(dunningNotices(3, 2).map((n) => n.key)).toEqual(['overdue', 'read_only', 'suspended']);
  });
});

describe('licences (BR-49)', () => {
  it('FX-41: is valid to its expiry, in grace for 30 days, then expired', () => {
    expect(licenceState('2027-03-31', '2027-03-31')).toEqual({
      state: 'valid',
      graceEndsOn: '2027-04-30',
    });
    expect(licenceState('2027-03-31', '2027-04-01').state).toBe('grace');
    expect(licenceState('2027-03-31', '2027-04-30').state).toBe('grace');
    expect(licenceState('2027-03-31', '2027-05-01').state).toBe('expired');
  });
});
