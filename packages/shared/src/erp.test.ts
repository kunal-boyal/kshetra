import { describe, expect, it } from 'vitest';
import {
  callsLeft,
  customerRow,
  decimalCell,
  type ErpMapping,
  invoiceRow,
  itemRow,
  paymentRow,
  perItemSalesBook,
  type ZohoContact,
  zohoHostIssue,
  zohoRegionOf,
} from './erp';

const MAPPING: ErpMapping = {
  accountType: 'distributor',
  territoryField: 'Territory',
  defaultTerritory: 'PUNE',
  units: { pcs: 'piece' },
};

const contact = (patch: Partial<ZohoContact> = {}): ZohoContact => ({
  contact_id: '460000000026049',
  contact_name: 'Ravi Kumar',
  company_name: 'Shree Ganesh Agencies',
  contact_number: 'C-1042',
  contact_type: 'customer',
  status: 'active',
  billing_address: {
    address: '12 Market Road',
    street2: 'Near the bus stand',
    city: 'Nashik',
    state: 'Maharashtra',
    zip: '422001',
  },
  custom_fields: [{ label: 'Territory', value: 'NSK' }],
  ...patch,
});

describe('Zoho hosts (FX-70, BR-59)', () => {
  it('takes only Zoho’s own accounts servers and API domains, over HTTPS on 443', () => {
    expect(zohoHostIssue('https://accounts.zoho.in', 'accounts')).toBeNull();
    expect(zohoHostIssue('https://accounts.zoho.in/', 'accounts')).toBeNull();
    expect(zohoHostIssue('https://accounts.zohocloud.ca:443', 'accounts')).toBeNull();
    expect(zohoHostIssue('https://www.zohoapis.in', 'api')).toBeNull();
    expect(zohoHostIssue('https://ACCOUNTS.ZOHO.EU', 'accounts')).toBeNull();
  });

  it('refuses look-alikes, plain HTTP, other ports, paths, credentials and the wrong kind', () => {
    expect(zohoHostIssue('https://accounts.zoho.in.evil.example', 'accounts')).toBe('not_zoho');
    expect(zohoHostIssue('https://evilaccounts.zoho.in', 'accounts')).toBe('not_zoho');
    expect(zohoHostIssue('http://accounts.zoho.in', 'accounts')).toBe('not_https');
    expect(zohoHostIssue('https://accounts.zoho.in:8443', 'accounts')).toBe('not_443');
    expect(zohoHostIssue('https://accounts.zoho.in/oauth', 'accounts')).toBe('not_a_host');
    expect(zohoHostIssue('https://accounts.zoho.in?x=1', 'accounts')).toBe('not_a_host');
    expect(zohoHostIssue('https://me@accounts.zoho.in', 'accounts')).toBe('not_a_host');
    expect(zohoHostIssue('https://www.zohoapis.in', 'accounts')).toBe('not_zoho');
    expect(zohoHostIssue('accounts.zoho.in', 'accounts')).toBe('not_an_address');
  });

  it('names the region of an accounts server', () => {
    expect(zohoRegionOf('https://accounts.zoho.in')).toBe('in');
    expect(zohoRegionOf('https://accounts.zohocloud.ca/')).toBe('ca');
    expect(zohoRegionOf('https://accounts.example.com')).toBeNull();
  });
});

describe('a customer as an account (FX-71, BR-59)', () => {
  it('takes the customer number as its code, the territory field and the billing address', () => {
    expect(customerRow(contact(), MAPPING, null)).toEqual({
      row: {
        code: 'C-1042',
        name: 'Shree Ganesh Agencies',
        territory_code: 'NSK',
        address: '12 Market Road, Near the bus stand',
        city: 'Nashik',
        state: 'Maharashtra',
        pin: '422001',
        active: 'yes',
      },
    });
  });

  it('keeps the present territory, then the default, when the field is empty', () => {
    const blank = contact({ custom_fields: [] });
    expect(customerRow(blank, MAPPING, 'MUM')).toMatchObject({ row: { territory_code: 'MUM' } });
    expect(customerRow(blank, MAPPING, null)).toMatchObject({ row: { territory_code: 'PUNE' } });
    expect(customerRow(blank, { ...MAPPING, defaultTerritory: null }, null)).toEqual({
      issue: 'no_territory',
    });
  });

  it('lists a contact without a number, and reads nothing without an account type', () => {
    expect(customerRow(contact({ contact_number: ' ' }), MAPPING, null)).toEqual({
      issue: 'no_customer_number',
    });
    expect(customerRow(contact(), { ...MAPPING, accountType: null }, null)).toEqual({
      issue: 'no_account_type',
    });
  });

  it('uses the contact’s name without a company, and marks an inactive one', () => {
    const row = customerRow(contact({ company_name: '', status: 'inactive' }), MAPPING, null);
    expect(row).toMatchObject({ row: { name: 'Ravi Kumar', active: 'no' } });
  });
});

describe('an item and its prices (FX-72, BR-59)', () => {
  const item = {
    item_id: '460000000027001',
    name: 'Tea 250 g',
    sku: 'TEA-250',
    group_name: 'Tea',
    unit: 'pcs',
    rate: 120.5,
    tax_percentage: 5,
    hsn_or_sac: '0902',
    status: 'active',
  };

  it('takes the SKU as its code, the group as its product, and maps the unit', () => {
    expect(itemRow(item, MAPPING, { rate: item.rate, list: '' })).toEqual({
      row: {
        item_code: 'TEA-250',
        item_name: 'Tea 250 g',
        product_name: 'Tea',
        category: '',
        base_unit: 'piece',
        hsn: '0902',
        tax_rate: '5',
        price: '120.5',
        price_list: '',
        active: 'yes',
      },
    });
  });

  it('puts a price book’s rate in its list, and lists an item without a SKU', () => {
    expect(itemRow(item, MAPPING, { rate: '99.00', list: 'Wholesale' })).toMatchObject({
      row: { price: '99.00', price_list: 'Wholesale' },
    });
    expect(itemRow({ ...item, sku: '' }, MAPPING, { rate: 1, list: '' })).toEqual({
      issue: 'no_sku',
    });
    expect(
      itemRow({ ...item, group_name: '', tax_percentage: undefined }, MAPPING, {
        rate: 1,
        list: '',
      }),
    ).toMatchObject({ row: { product_name: 'Tea 250 g', tax_rate: '0' } });
  });

  it('reads only per-item sales books', () => {
    const book = { pricebook_id: '1', name: 'Wholesale' };
    expect(perItemSalesBook(book)).toBe(true);
    expect(perItemSalesBook({ ...book, pricebook_type: 'fixed_percentage' })).toBe(false);
    expect(perItemSalesBook({ ...book, sales_or_purchase_type: 'purchases' })).toBe(false);
  });

  it('writes decimals without exponents or float noise', () => {
    expect(decimalCell(0.1 + 0.2)).toBe('0.3');
    expect(decimalCell(1500)).toBe('1500');
    expect(decimalCell(1500.5)).toBe('1500.5');
    expect(decimalCell(' 99.90 ')).toBe('99.90');
    expect(decimalCell(undefined)).toBe('');
  });
});

describe('invoices and payments (FX-73, BR-51, BR-59)', () => {
  const invoice = {
    invoice_id: '1',
    invoice_number: 'INV-000041',
    customer_id: '460000000026049',
    date: '2026-10-05',
    due_date: '2026-11-04',
    total: 23600,
    status: 'overdue',
  };

  it('reads an invoice of a linked customer, cancels a void one and skips drafts', () => {
    expect(invoiceRow(invoice, 'C-1042')).toEqual({
      row: {
        number: 'INV-000041',
        account_code: 'C-1042',
        date: '2026-10-05',
        amount: '23600',
        due_date: '2026-11-04',
        status: 'open',
      },
    });
    expect(invoiceRow({ ...invoice, status: 'void' }, 'C-1042')).toMatchObject({
      row: { status: 'cancelled' },
    });
    expect(invoiceRow({ ...invoice, status: 'draft' }, 'C-1042')).toBeNull();
    expect(invoiceRow(invoice, null)).toEqual({ issue: 'unknown_customer' });
  });

  it('reads a payment as a receipt against the invoices it was applied to', () => {
    const payment = {
      payment_id: '2',
      payment_number: '17',
      customer_id: '460000000026049',
      date: '2026-10-20',
      amount: '10000.00',
      invoice_numbers: 'INV-000041, INV-000044,',
    };
    expect(paymentRow(payment, 'C-1042')).toEqual({
      row: {
        number: '17',
        account_code: 'C-1042',
        date: '2026-10-20',
        amount: '10000.00',
        kind: 'receipt',
        against: 'INV-000041, INV-000044',
      },
    });
    expect(paymentRow({ ...payment, invoice_numbers: undefined }, 'C-1042')).toMatchObject({
      row: { against: '' },
    });
    expect(paymentRow(payment, null)).toEqual({ issue: 'unknown_customer' });
  });
});

describe('the day’s calls (FX-74, BR-59)', () => {
  it('keeps a tenth of the plan’s daily limit back', () => {
    expect(callsLeft(0, 1000)).toBe(900);
    expect(callsLeft(899, 1000)).toBe(1);
    expect(callsLeft(900, 1000)).toBe(0);
    expect(callsLeft(950, 1000)).toBe(0);
  });
});
