/**
 * ERP connectors (module M20, BR-59, decision D129): the hosts a connection may reach, and how a
 * record read from the books becomes a row of one of the product's own import targets, so every
 * record passes that target's checks and nothing new writes to the tenant's data. Zoho Books
 * first; the shapes here are what its API v3 lists and reads (docs/integrations/zoho-books.md).
 */

import type { TenantPermission } from './access';
import { divide, scaled, unscaled } from './pricing';

export const ERP_PROVIDERS = ['zoho_books', 'sap_b1'] as const;
export type ErpProvider = (typeof ERP_PROVIDERS)[number];

/**
 * What a connection may do (decision D129): load accounts, items and prices, invoices and
 * receipts through their imports, and read orders to send them; switched-off modules take theirs.
 */
export const ERP_CONNECTOR_PERMISSIONS = [
  'import.run',
  'account.import',
  'catalogue.manage',
  'price_list.manage',
  'finance.manage',
  'order.view',
] as const satisfies readonly TenantPermission[];

/** Zoho's data centres: where each one's people sign in, and where its API answers. */
export const ZOHO_REGIONS = {
  in: { accounts: 'accounts.zoho.in', api: 'www.zohoapis.in' },
  com: { accounts: 'accounts.zoho.com', api: 'www.zohoapis.com' },
  eu: { accounts: 'accounts.zoho.eu', api: 'www.zohoapis.eu' },
  'com.au': { accounts: 'accounts.zoho.com.au', api: 'www.zohoapis.com.au' },
  jp: { accounts: 'accounts.zoho.jp', api: 'www.zohoapis.jp' },
  ca: { accounts: 'accounts.zohocloud.ca', api: 'www.zohoapis.ca' },
  'com.cn': { accounts: 'accounts.zoho.com.cn', api: 'www.zohoapis.com.cn' },
  sa: { accounts: 'accounts.zoho.sa', api: 'www.zohoapis.sa' },
  ae: { accounts: 'accounts.zoho.ae', api: 'www.zohoapis.ae' },
} as const;
export type ZohoRegion = keyof typeof ZOHO_REGIONS;
export const ZOHO_REGION_KEYS = Object.keys(ZOHO_REGIONS) as [ZohoRegion, ...ZohoRegion[]];

/**
 * Why an address isn't one of Zoho's own (BR-59), or null when it is: HTTPS on 443 to a listed
 * accounts server or API domain, with nothing but a host. The redirect names the accounts server
 * and the token names the API domain; both are checked before the client secret or a token goes
 * there.
 */
export function zohoHostIssue(address: string, kind: 'accounts' | 'api'): string | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i.exec(address.trim());
  if (!match) return 'not_an_address';
  const [, scheme, authority, rest] = match as unknown as [string, string, string, string];
  if (scheme.toLowerCase() !== 'https') return 'not_https';
  if (authority.includes('@')) return 'not_a_host';
  if (rest !== '' && rest !== '/') return 'not_a_host';
  const [host = '', port] = authority.toLowerCase().split(':');
  if (port !== undefined && port !== '443') return 'not_443';
  const hosts: readonly string[] = Object.values(ZOHO_REGIONS).map((region) => region[kind]);
  return hosts.includes(host) ? null : 'not_zoho';
}

/** The region an accounts server belongs to, once it passed `zohoHostIssue`. */
export function zohoRegionOf(accountsServer: string): ZohoRegion | null {
  const host = accountsServer
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/(:443)?\/?$/, '');
  return ZOHO_REGION_KEYS.find((key) => ZOHO_REGIONS[key].accounts === host) ?? null;
}

/** A custom field as Zoho lists it on a record. */
export interface ZohoCustomField {
  label?: string;
  api_name?: string;
  value?: unknown;
}

export interface ZohoAddress {
  address?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
}

/** A contact, as `GET /contacts/{id}` gives it; only customers are read. */
export interface ZohoContact {
  contact_id: string;
  contact_name: string;
  company_name?: string;
  contact_number?: string;
  contact_type?: string;
  status?: string;
  last_modified_time?: string;
  billing_address?: ZohoAddress;
  custom_fields?: ZohoCustomField[];
}

/** An item, as `GET /items` lists it. */
export interface ZohoItem {
  item_id: string;
  name: string;
  sku?: string;
  group_name?: string;
  category_name?: string;
  unit?: string;
  rate?: number | string;
  tax_percentage?: number | string;
  hsn_or_sac?: string;
  status?: string;
  last_modified_time?: string;
}

/** A price book's rate for one item. */
export interface ZohoPriceBookItem {
  item_id: string;
  pricebook_rate: number | string;
}

export interface ZohoPriceBook {
  pricebook_id: string;
  name: string;
  pricebook_type?: string;
  sales_or_purchase_type?: string;
  pricebook_items?: ZohoPriceBookItem[];
}

/** An invoice, as `GET /invoices` lists it. */
export interface ZohoInvoice {
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  date: string;
  due_date?: string;
  total: number | string;
  status: string;
  last_modified_time?: string;
}

/** A customer payment, as `GET /customerpayments` lists it. */
export interface ZohoPayment {
  payment_id: string;
  payment_number: string;
  customer_id: string;
  date: string;
  amount: number | string;
  /** The invoices it was applied to, comma separated. */
  invoice_numbers?: string;
  last_modified_time?: string;
}

/** What a connection reads into which of the tenant's records (the portal's mappings). */
export interface ErpMapping {
  accountType: string | null;
  territoryField: string | null;
  defaultTerritory: string | null;
  /** Zoho's unit names to the catalogue's units, where they differ. */
  units: Readonly<Record<string, string>>;
}

/** One row of an import target, by field key, as a file's cells would hold it. */
export type ErpRow = Record<string, string>;

/** A record that becomes a row, or why it can't (an issue key, `erp.issue_<key>` in the strings). */
export type ErpMapped = { row: ErpRow } | { issue: ErpIssue };

export const ERP_ISSUES = [
  'no_customer_number',
  'no_account_type',
  'no_territory',
  'no_sku',
  'unknown_customer',
  'duplicate_code',
  'not_per_item',
  'not_in_books',
  'no_tax_rate',
  'refused',
] as const;
export type ErpIssue = (typeof ERP_ISSUES)[number];

const text = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value).trim();

/** A decimal as the books give it, written as an import cell: plain digits, no exponent. */
export function decimalCell(value: number | string | undefined): string {
  if (value === undefined || value === '') return '';
  if (typeof value === 'string') return value.trim();
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

const customValue = (fields: readonly ZohoCustomField[] | undefined, label: string) =>
  text(
    fields?.find(
      (field) =>
        text(field.label).toLowerCase() === label.toLowerCase() ||
        text(field.api_name).toLowerCase() === label.toLowerCase(),
    )?.value,
  );

/**
 * A customer as an account of the mapped type (BR-59): the code is the customer number, the
 * territory the custom field the mapping names, else the account's present one, else the default;
 * the address is the billing address. A contact without a number is listed, never guessed.
 */
export function customerRow(
  contact: ZohoContact,
  mapping: ErpMapping,
  presentTerritory: string | null,
): ErpMapped {
  const code = text(contact.contact_number);
  if (!code) return { issue: 'no_customer_number' };
  if (!mapping.accountType) return { issue: 'no_account_type' };
  const territory =
    (mapping.territoryField ? customValue(contact.custom_fields, mapping.territoryField) : '') ||
    presentTerritory ||
    text(mapping.defaultTerritory);
  if (!territory) return { issue: 'no_territory' };
  const address = contact.billing_address ?? {};
  return {
    row: {
      code,
      name: text(contact.company_name) || text(contact.contact_name),
      territory_code: territory,
      address: [text(address.address), text(address.street2)].filter(Boolean).join(', '),
      city: text(address.city),
      state: text(address.state),
      pin: text(address.zip),
      active: text(contact.status) === 'inactive' ? 'no' : 'yes',
    },
  };
}

/**
 * An item of the catalogue (BR-59): the code is the SKU, the product its group, else its own
 * name; the rate is its price in the given list (blank: the default list). Units Zoho names
 * otherwise than the catalogue go through the mapping.
 */
export function itemRow(
  item: ZohoItem,
  mapping: ErpMapping,
  price: { rate: number | string | undefined; list: string },
): ErpMapped {
  const code = text(item.sku);
  if (!code) return { issue: 'no_sku' };
  const unit = text(item.unit);
  return {
    row: {
      item_code: code,
      item_name: text(item.name),
      product_name: text(item.group_name) || text(item.name),
      category: text(item.category_name),
      base_unit: mapping.units[unit] ?? unit,
      hsn: text(item.hsn_or_sac),
      tax_rate: decimalCell(item.tax_percentage) || '0',
      price: decimalCell(price.rate),
      price_list: price.list,
      active: text(item.status) === 'inactive' ? 'no' : 'yes',
    },
  };
}

/** Whether a price book holds a rate per item, which is all a connection reads of books. */
export function perItemSalesBook(book: ZohoPriceBook): boolean {
  return (
    (book.pricebook_type ?? 'per_item') === 'per_item' &&
    (book.sales_or_purchase_type ?? 'sales') === 'sales'
  );
}

/**
 * An invoice of the account its customer is (BR-51, BR-59): drafts aren't read, and void ones
 * are cancelled; null for a draft.
 */
export function invoiceRow(invoice: ZohoInvoice, accountCode: string | null): ErpMapped | null {
  if (invoice.status === 'draft') return null;
  if (!accountCode) return { issue: 'unknown_customer' };
  return {
    row: {
      number: text(invoice.invoice_number),
      account_code: accountCode,
      date: text(invoice.date),
      amount: decimalCell(invoice.total),
      due_date: text(invoice.due_date),
      status: invoice.status === 'void' ? 'cancelled' : 'open',
    },
  };
}

/** A payment as a receipt, naming the invoices it was applied to, which BR-51 settles first. */
export function paymentRow(payment: ZohoPayment, accountCode: string | null): ErpMapped {
  if (!accountCode) return { issue: 'unknown_customer' };
  return {
    row: {
      number: text(payment.payment_number),
      account_code: accountCode,
      date: text(payment.date),
      amount: decimalCell(payment.amount),
      kind: 'receipt',
      against: text(payment.invoice_numbers)
        .split(',')
        .map((number) => number.trim())
        .filter(Boolean)
        .join(', '),
    },
  };
}

/** Zoho's per-minute limit is 100 a minute for an organisation; a connection paces under it. */
export const ZOHO_CALLS_PER_MINUTE = 90;

/**
 * How many more calls a run may make today (BR-59): the plan's daily limit less a tenth kept back
 * for the people using the books themselves, less what was used.
 */
export function callsLeft(usedToday: number, dailyLimit: number): number {
  return Math.max(0, Math.floor(dailyLimit * 0.9) - usedToday);
}

/** An order as the books are sent it (decision D129): its number, day and lines as decided. */
export interface ErpOrder {
  number: number;
  /** The day it was placed, on the tenant's clock. */
  date: string;
  accountCode: string;
  lines: {
    id: string;
    itemCode: string;
    decision: 'pending' | 'accepted' | 'rejected';
    /** The quantity in the item's base unit, as Zoho counts it. */
    baseUnits: string;
    /** What the line comes to before tax, after its scheme. */
    taxable: string;
    /** Free goods name the line they come with. */
    freeOfLineId: string | null;
  }[];
}

/** A sales order as Zoho Books takes it. */
export interface ZohoSalesOrderBody {
  customer_id: string;
  date: string;
  reference_number: string;
  line_items: { item_id: string; quantity: number; rate: number }[];
}

/**
 * An accepted order as a sales order (BR-59): the accepted lines and the free goods that come
 * with them, each in the item's base unit at its rate before tax after the scheme, so the books
 * apply the item's own tax; the reference is the order's number. An order whose customer or any
 * item isn't linked to the books names what is missing and waits; none accepted sends nothing.
 */
export function salesOrderFor(
  order: ErpOrder,
  customerId: string | null,
  itemIdOf: (itemCode: string) => string | null,
): { body: ZohoSalesOrderBody } | { missing: string[] } | { nothing: true } {
  const accepted = new Set(
    order.lines
      .filter((line) => line.decision === 'accepted' && !line.freeOfLineId)
      .map((line) => line.id),
  );
  const lines = order.lines.filter((line) =>
    line.freeOfLineId ? accepted.has(line.freeOfLineId) : accepted.has(line.id),
  );
  if (lines.length === 0) return { nothing: true };
  const missing = [
    ...(customerId ? [] : [`account:${order.accountCode}`]),
    ...[...new Set(lines.map((line) => line.itemCode))]
      .filter((code) => !itemIdOf(code))
      .map((code) => `item:${code}`),
  ];
  if (missing.length > 0) return { missing };
  return {
    body: {
      customer_id: customerId!,
      date: order.date,
      reference_number: String(order.number),
      line_items: lines.map((line) => {
        const units = scaled(line.baseUnits, 3);
        // Paise per base unit, rounded half up: taxable × 1000 ÷ milli-units.
        const rate = units === 0n ? 0n : divide(scaled(line.taxable, 2) * 1000n, units);
        return {
          item_id: itemIdOf(line.itemCode)!,
          // Numbers only on the way out, as Zoho's JSON takes them; worked out exactly above.
          quantity: Number(unscaled(units, 3)),
          rate: Number(unscaled(rate, 2)),
        };
      }),
    },
  };
}
