import { describe, expect, it } from 'vitest';
import {
  type TallyLedger,
  type TallyMapping,
  type TallyStockItem,
  type TallyVoucher,
  tallyCustomerRow,
  tallyDate,
  tallyDebit,
  tallyInvoiceRow,
  tallyItemRow,
  tallyNumber,
  tallyQuantity,
  tallyRate,
  tallyReceiptRow,
  tallyUnder,
  tallyVoucherKind,
} from './erp-tally';

const MAPPING: TallyMapping = {
  accountType: 'distributor',
  territoryField: null,
  defaultTerritory: 'PUNE',
  units: { Nos: 'piece' },
  debtorGroups: ['Sundry Debtors'],
  groupTerritories: { 'Debtors - Nashik': 'NSK' },
  defaultTaxRate: '18',
  salesTypes: ['Sales'],
  receiptTypes: ['Receipt'],
};

const GROUPS = new Map([
  ['Sundry Debtors', 'Current Assets'],
  ['Debtors - Nashik', 'Sundry Debtors'],
  ['Nashik Rural', 'Debtors - Nashik'],
  ['Sundry Creditors', 'Current Liabilities'],
]);

describe('numbers, quantities, rates and dates as Tally writes them (FX-82, BR-61)', () => {
  it('reads signed amounts exactly, and tells debits by their sign', () => {
    expect(tallyNumber('-1180.00')).toBe('1180.00');
    expect(tallyNumber(' 23600.5 ')).toBe('23600.5');
    expect(tallyNumber('1,18,000.00')).toBe('118000.00');
    expect(tallyNumber('')).toBe('');
    expect(tallyNumber('Nos')).toBe('');
    expect(tallyDebit('-1180.00')).toBe(true);
    expect(tallyDebit('1180.00')).toBe(false);
  });

  it('splits quantities and rates from their units', () => {
    expect(tallyQuantity(' 12 Nos')).toEqual({ quantity: '12', unit: 'Nos' });
    expect(tallyQuantity(' 2.500 Kgs')).toEqual({ quantity: '2.500', unit: 'Kgs' });
    expect(tallyQuantity(' 3 Box = 36 Nos')).toEqual({ quantity: '3', unit: 'Box' });
    expect(tallyRate('450.00/Nos')).toEqual({ rate: '450.00', unit: 'Nos' });
    expect(tallyRate('450.00')).toEqual({ rate: '450.00', unit: '' });
    expect(tallyRate('per box')).toBeNull();
  });

  it('turns YYYYMMDD into ISO dates', () => {
    expect(tallyDate('20251101')).toBe('2025-11-01');
    expect(tallyDate('1-Nov-2025')).toBe('');
  });
});

describe('groups and voucher types through their parents (FX-83, BR-61)', () => {
  it('finds groups under Sundry Debtors at any depth, and stops on a loop', () => {
    expect(tallyUnder('Nashik Rural', ['Sundry Debtors'], GROUPS)).toBe(true);
    expect(tallyUnder('sundry debtors', ['Sundry Debtors'], GROUPS)).toBe(true);
    expect(tallyUnder('Sundry Creditors', ['Sundry Debtors'], GROUPS)).toBe(false);
    expect(tallyUnder('Unknown', ['Sundry Debtors'], GROUPS)).toBe(false);
    const loop = new Map([
      ['A', 'B'],
      ['B', 'A'],
    ]);
    expect(tallyUnder('A', ['Sundry Debtors'], loop)).toBe(false);
  });

  it('reads a renamed voucher type by the type above it', () => {
    const types = new Map([
      ['GST Sales', 'Sales'],
      ['Sales', 'Sales'],
      ['Bank Receipt', 'Receipt'],
    ]);
    const voucher = (type: string) => ({ type }) as TallyVoucher;
    expect(tallyVoucherKind(voucher('GST Sales'), MAPPING, types)).toBe('sale');
    expect(tallyVoucherKind(voucher('Bank Receipt'), MAPPING, types)).toBe('receipt');
    expect(tallyVoucherKind(voucher('Journal'), MAPPING, types)).toBeNull();
  });
});

describe('a ledger as an account (FX-84, BR-61)', () => {
  const ledger: TallyLedger = {
    guid: 'a1b2-0001',
    name: 'Shree Ganesh Agencies',
    aliases: ['Ganesh Agencies, Nashik', 'SGA-014'],
    parent: 'Nashik Rural',
    alterId: '41',
    address: ['12 Market Road', 'Near the bus stand'],
    state: 'Maharashtra',
    pincode: '422001',
  };

  it('takes the first alias that is a code, and the territory of the nearest mapped group', () => {
    expect(tallyCustomerRow(ledger, MAPPING, GROUPS, null)).toEqual({
      row: {
        code: 'SGA-014',
        name: 'Shree Ganesh Agencies',
        territory_code: 'NSK',
        address: '12 Market Road, Near the bus stand',
        state: 'Maharashtra',
        pin: '422001',
      },
    });
  });

  it('falls back to the present territory, then the default', () => {
    const plain = { ...ledger, parent: 'Sundry Debtors' };
    expect(tallyCustomerRow(plain, MAPPING, GROUPS, 'MUM')).toMatchObject({
      row: { territory_code: 'MUM' },
    });
    expect(tallyCustomerRow(plain, MAPPING, GROUPS, null)).toMatchObject({
      row: { territory_code: 'PUNE' },
    });
  });

  it('never makes a code from the name, and leaves other ledgers alone', () => {
    expect(tallyCustomerRow({ ...ledger, aliases: [] }, MAPPING, GROUPS, null)).toEqual({
      issue: 'no_customer_number',
    });
    expect(tallyCustomerRow({ ...ledger, parent: 'Sundry Creditors' }, MAPPING, GROUPS, null)).toBe(
      null,
    );
    expect(tallyCustomerRow(ledger, { ...MAPPING, accountType: null }, GROUPS, null)).toEqual({
      issue: 'no_account_type',
    });
  });
});

describe('a stock item as an item (FX-85, BR-61)', () => {
  const item: TallyStockItem = {
    guid: 'a1b2-0101',
    name: 'Neem Gold 1 L',
    aliases: ['NG-1L'],
    parent: 'Bio Pesticides',
    alterId: '77',
    baseUnits: 'Nos',
    gst: [
      { from: '20170701', hsn: '38089199', rate: ' 12' },
      { from: '20251001', hsn: '38089199', rate: ' 18' },
    ],
    prices: [
      { level: 'Dealer', date: '20250401', rate: '410.00/Nos' },
      { level: 'Dealer', date: '20251101', rate: '425.50/Nos' },
      { level: 'Retail', date: '20250401', rate: '480.00/Nos' },
    ],
  };

  it('takes the alias, the group, the unit through the mapping and the GST in force', () => {
    expect(tallyItemRow(item, MAPPING, '2025-10-15', { level: 'Dealer', list: 'Dealers' })).toEqual(
      {
        row: {
          item_code: 'NG-1L',
          item_name: 'Neem Gold 1 L',
          product_name: 'Bio Pesticides',
          base_unit: 'piece',
          hsn: '38089199',
          tax_rate: '18',
          price: '410.00',
          price_list: 'Dealers',
        },
      },
    );
  });

  it('takes the level’s latest rate dated on or before the day, and none from another level', () => {
    expect(tallyItemRow(item, MAPPING, '2025-11-02', { level: 'dealer', list: '' })).toMatchObject({
      row: { price: '425.50' },
    });
    expect(
      tallyItemRow(item, MAPPING, '2025-11-02', { level: 'Wholesale', list: '' }),
    ).toMatchObject({ row: { price: '' } });
  });

  it('uses the default rate without GST details, and lists an item without an alias', () => {
    expect(
      tallyItemRow({ ...item, gst: [] }, MAPPING, '2025-11-02', { level: null, list: '' }),
    ).toMatchObject({ row: { tax_rate: '18', hsn: '' } });
    expect(
      tallyItemRow({ ...item, gst: [] }, { ...MAPPING, defaultTaxRate: null }, '2025-11-02', {
        level: null,
        list: '',
      }),
    ).toEqual({ issue: 'no_tax_rate' });
    expect(
      tallyItemRow({ ...item, aliases: [] }, MAPPING, '2025-11-02', { level: null, list: '' }),
    ).toEqual({ issue: 'no_sku' });
  });
});

describe('sales vouchers as invoices (FX-86, BR-61)', () => {
  const sale: TallyVoucher = {
    guid: 'a1b2-1001',
    type: 'Sales',
    date: '20251020',
    number: 'SI/25-26/0412',
    party: 'Shree Ganesh Agencies',
    reference: '',
    cancelled: false,
    partyAmount: '-23600.00',
    bills: [
      { name: 'SI/25-26/0412', type: 'New Ref', amount: '-23600.00', creditPeriod: '30 Days' },
    ],
  };

  it('takes the number, the day, the party’s amount and the due date from the credit period', () => {
    expect(tallyInvoiceRow(sale, 'SGA-014')).toEqual({
      row: {
        number: 'SI/25-26/0412',
        account_code: 'SGA-014',
        date: '2025-10-20',
        amount: '23600.00',
        due_date: '2025-11-19',
        status: 'open',
      },
    });
  });

  it('cancels a cancelled voucher, and lists one whose party isn’t a customer read', () => {
    expect(tallyInvoiceRow({ ...sale, cancelled: true }, 'SGA-014')).toMatchObject({
      row: { status: 'cancelled' },
    });
    expect(tallyInvoiceRow({ ...sale, bills: [] }, 'SGA-014')).toMatchObject({
      row: { due_date: '' },
    });
    expect(tallyInvoiceRow(sale, null)).toEqual({ issue: 'unknown_customer' });
  });
});

describe('receipt vouchers as receipts (FX-87, BR-61)', () => {
  it('settles the bills its Agst Ref allocations name, and leaves the rest on account', () => {
    const receipt: TallyVoucher = {
      guid: 'a1b2-2001',
      type: 'Receipt',
      date: '20251101',
      number: '87',
      party: 'Shree Ganesh Agencies',
      reference: '',
      cancelled: false,
      partyAmount: '30000.00',
      bills: [
        { name: 'SI/25-26/0412', type: 'Agst Ref', amount: '23600.00', creditPeriod: '' },
        { name: 'SI/25-26/0430', type: 'Agst Ref', amount: '5000.00', creditPeriod: '' },
        { name: '', type: 'On Account', amount: '1400.00', creditPeriod: '' },
      ],
    };
    expect(tallyReceiptRow(receipt, 'SGA-014')).toEqual({
      row: {
        number: '87',
        account_code: 'SGA-014',
        date: '2025-11-01',
        amount: '30000.00',
        kind: 'receipt',
        against: 'SI/25-26/0412, SI/25-26/0430',
        status: 'open',
      },
    });
  });
});
