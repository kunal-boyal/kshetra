import { describe, expect, it } from 'vitest';
import type { ErpOrder } from './erp';
import {
  type SapMapping,
  sapCustomerRow,
  sapEndpointIssue,
  sapInvoiceRow,
  sapOrderFor,
  sapItemRow,
  sapPaymentRow,
  sapPaymentTotal,
  sapServiceRoot,
} from './erp-sap';

const MAPPING: SapMapping = {
  accountType: 'distributor',
  territoryField: 'U_Territory',
  defaultTerritory: 'PUNE',
  units: { Nos: 'piece' },
  taxRateField: 'U_GST',
  defaultTaxRate: '18',
};

describe('the Service Layer’s address (FX-77, BR-60)', () => {
  it('takes HTTPS on 443 with a host, with or without the Service Layer’s path', () => {
    expect(sapEndpointIssue('https://b1.sunrise.example')).toBeNull();
    expect(sapEndpointIssue('https://b1.sunrise.example:443/b1s/v2/')).toBeNull();
    expect(sapServiceRoot('https://B1.Sunrise.example:443/b1s/v2/')).toBe(
      'https://b1.sunrise.example/b1s/v2',
    );
  });

  it('refuses plain HTTP, SAP’s own port, other paths, credentials and queries', () => {
    expect(sapEndpointIssue('http://b1.sunrise.example')).toBe('not_https');
    expect(sapEndpointIssue('https://b1.sunrise.example:50000/b1s/v2')).toBe('not_443');
    expect(sapEndpointIssue('https://b1.sunrise.example/b1s/v1')).toBe('not_service_layer');
    expect(sapEndpointIssue('https://user@b1.sunrise.example')).toBe('not_a_host');
    expect(sapEndpointIssue('https://b1.sunrise.example?x=1')).toBe('not_a_host');
    expect(sapEndpointIssue('b1.sunrise.example')).toBe('not_an_address');
  });
});

describe('a business partner as an account (FX-78, BR-60)', () => {
  const partner = {
    CardCode: 'C20000',
    CardName: 'Shree Ganesh Agencies',
    CardType: 'cCustomer',
    Frozen: 'tNO',
    Valid: 'tYES',
    U_Territory: 'NSK',
    BPAddresses: [
      { AddressType: 'bo_ShipTo', Street: 'Godown 4', City: 'Sinnar' },
      {
        AddressType: 'bo_BillTo',
        Street: '12 Market Road',
        Block: 'Near the bus stand',
        City: 'Nashik',
        State: 'MH',
        ZipCode: '422001',
      },
    ],
  };

  it('takes the CardCode as its code, the territory field and the bill-to address', () => {
    expect(sapCustomerRow(partner, MAPPING, null)).toEqual({
      row: {
        code: 'C20000',
        name: 'Shree Ganesh Agencies',
        territory_code: 'NSK',
        address: '12 Market Road, Near the bus stand',
        city: 'Nashik',
        state: 'MH',
        pin: '422001',
        active: 'yes',
      },
    });
  });

  it('keeps the present territory, then the default, and marks a frozen partner inactive', () => {
    const blank = { ...partner, U_Territory: '' };
    expect(sapCustomerRow(blank, MAPPING, 'MUM')).toMatchObject({ row: { territory_code: 'MUM' } });
    expect(sapCustomerRow(blank, MAPPING, null)).toMatchObject({ row: { territory_code: 'PUNE' } });
    expect(sapCustomerRow({ ...partner, Frozen: 'tYES' }, MAPPING, null)).toMatchObject({
      row: { active: 'no' },
    });
    expect(sapCustomerRow(partner, { ...MAPPING, accountType: null }, null)).toEqual({
      issue: 'no_account_type',
    });
  });
});

describe('an item and its price (FX-79, BR-60)', () => {
  const item = {
    ItemCode: 'TEA-250',
    ItemName: 'Tea 250 g',
    ItemsGroupCode: 101,
    SalesUnit: 'Nos',
    ChapterID: '0902',
    Frozen: 'tNO',
    U_GST: '5',
  };

  it('takes the ItemCode, the group’s name, the mapped unit and the GST field', () => {
    expect(sapItemRow(item, MAPPING, 'Tea', { rate: 120.5, list: 'Wholesale' })).toEqual({
      row: {
        item_code: 'TEA-250',
        item_name: 'Tea 250 g',
        product_name: 'Tea',
        base_unit: 'piece',
        hsn: '0902',
        tax_rate: '5',
        price: '120.5',
        price_list: 'Wholesale',
        active: 'yes',
      },
    });
  });

  it('falls back to the default rate, and lists an item with neither', () => {
    expect(
      sapItemRow({ ...item, U_GST: '' }, MAPPING, null, { rate: null, list: '' }),
    ).toMatchObject({
      row: { tax_rate: '18', product_name: 'Tea 250 g', price: '' },
    });
    expect(
      sapItemRow({ ...item, U_GST: '' }, { ...MAPPING, defaultTaxRate: null }, null, {
        rate: 1,
        list: '',
      }),
    ).toEqual({ issue: 'no_tax_rate' });
  });
});

describe('invoices and incoming payments (FX-80, BR-51, BR-60)', () => {
  it('reads an invoice by its number, cancelling a cancelled one, only for a linked customer', () => {
    const invoice = {
      DocEntry: 812,
      DocNum: 10041,
      CardCode: 'C20000',
      DocDate: '2026-10-05T00:00:00Z',
      DocDueDate: '2026-11-04',
      DocTotal: 23600,
      Cancelled: 'tNO',
    };
    expect(sapInvoiceRow(invoice, true)).toEqual({
      row: {
        number: '10041',
        account_code: 'C20000',
        date: '2026-10-05',
        amount: '23600',
        due_date: '2026-11-04',
        status: 'open',
      },
    });
    expect(sapInvoiceRow({ ...invoice, Cancelled: 'tYES' }, true)).toMatchObject({
      row: { status: 'cancelled' },
    });
    expect(sapInvoiceRow(invoice, false)).toEqual({ issue: 'unknown_customer' });
  });

  it('adds up a payment exactly and names the invoices it was applied to', () => {
    const payment = {
      DocEntry: 77,
      DocNum: 501,
      CardCode: 'C20000',
      DocDate: '2026-10-20',
      CashSum: 0.1,
      TransferSum: '9999.20',
      PaymentChecks: [{ CheckSum: 0.7 }],
      PaymentInvoices: [
        { DocEntry: 812, InvoiceType: 'it_Invoice' },
        { DocEntry: 9, InvoiceType: 'it_JournalEntry' },
      ],
    };
    expect(sapPaymentTotal(payment)).toBe('10000.00');
    expect(sapPaymentRow(payment, true, (entry) => (entry === 812 ? '10041' : null))).toEqual({
      row: {
        number: '501',
        account_code: 'C20000',
        date: '2026-10-20',
        amount: '10000.00',
        kind: 'receipt',
        against: '10041',
        status: 'open',
      },
    });
  });
});

describe('an accepted order as a SAP sales order (FX-81, BR-60)', () => {
  const order: ErpOrder = {
    number: 1042,
    date: '2026-11-02',
    accountCode: 'C20000',
    lines: [
      {
        id: 'l1',
        itemCode: 'TEA-250',
        decision: 'accepted',
        baseUnits: '24.000',
        taxable: '2468.50',
        freeOfLineId: null,
      },
      {
        id: 'l2',
        itemCode: 'TEA-250',
        decision: 'accepted',
        baseUnits: '2.000',
        taxable: '0.00',
        freeOfLineId: 'l1',
      },
      {
        id: 'l3',
        itemCode: 'SOAP-100',
        decision: 'rejected',
        baseUnits: '10.000',
        taxable: '300.00',
        freeOfLineId: null,
      },
    ],
  };

  it('sends the accepted lines and free goods with the order’s number as NumAtCard', () => {
    expect(sapOrderFor(order, true, () => true)).toEqual({
      body: {
        CardCode: 'C20000',
        DocDate: '2026-11-02',
        DocDueDate: '2026-11-02',
        NumAtCard: '1042',
        DocumentLines: [
          { ItemCode: 'TEA-250', Quantity: 24, UnitPrice: 102.85 },
          { ItemCode: 'TEA-250', Quantity: 2, UnitPrice: 0 },
        ],
      },
    });
  });

  it('waits while the customer or an item hasn’t come in from SAP', () => {
    expect(sapOrderFor(order, false, (code) => code !== 'TEA-250')).toEqual({
      missing: ['account:C20000', 'item:TEA-250'],
    });
  });
});
