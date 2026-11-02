import { decimalCell, type ErpMapped, type ErpMapping } from './erp';

/**
 * SAP Business One through its Service Layer (module M20, BR-60, decision D129): what a connection
 * reads of business partners, items, A/R invoices and incoming payments, as rows of the product's
 * own import targets, as Zoho's records are (BR-59). The shapes are the Service Layer's (OData v4,
 * `/b1s/v2`); docs/integrations/sap-business-one.md says what is to be confirmed on a real system.
 */

/** Where a Service Layer answers: its own path, after the address the admin gives. */
export const SAP_SERVICE_PATH = '/b1s/v2';

/**
 * Why an address can't be a Service Layer's (BR-60), or null: HTTPS on 443 with a host, and no
 * credentials, query or fragment; a path, if any, is the Service Layer's own. The cell checks
 * again that the host is public before every call (D101).
 */
export function sapEndpointIssue(address: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)([?#].*)?$/i.exec(address.trim());
  if (!match) return 'not_an_address';
  const [, scheme, authority, path, rest] = match as unknown as [
    string,
    string,
    string,
    string,
    string | undefined,
  ];
  if (scheme.toLowerCase() !== 'https') return 'not_https';
  if (authority.includes('@')) return 'not_a_host';
  if (rest) return 'not_a_host';
  const [host = '', port] = authority.toLowerCase().split(':');
  if (!host) return 'not_a_host';
  if (port !== undefined && port !== '443') return 'not_443';
  const trimmed = path.replace(/\/+$/, '');
  if (trimmed !== '' && trimmed.toLowerCase() !== SAP_SERVICE_PATH) return 'not_service_layer';
  return null;
}

/** The Service Layer's root for an address that passed `sapEndpointIssue`. */
export function sapServiceRoot(address: string): string {
  const match = /^https:\/\/([^/?#]*)/i.exec(address.trim())!;
  const [host = '', port] = match[1]!.toLowerCase().split(':');
  return `https://${host}${port && port !== '443' ? `:${port}` : ''}${SAP_SERVICE_PATH}`;
}

export interface SapAddress {
  AddressName?: string;
  AddressType?: string;
  Street?: string;
  Block?: string;
  City?: string;
  ZipCode?: string;
  State?: string;
}

/** A business partner; user fields (`U_…`) sit beside the standard ones. */
export interface SapBusinessPartner {
  CardCode: string;
  CardName: string;
  CardType?: string;
  Frozen?: string;
  Valid?: string;
  UpdateDate?: string;
  BPAddresses?: SapAddress[];
  [field: string]: unknown;
}

export interface SapItemPrice {
  PriceList: number;
  Price: number | string | null;
}

export interface SapItem {
  ItemCode: string;
  ItemName: string;
  ItemsGroupCode?: number;
  SalesUnit?: string;
  InventoryUOM?: string;
  ChapterID?: number | string;
  Frozen?: string;
  Valid?: string;
  UpdateDate?: string;
  ItemPrices?: SapItemPrice[];
  [field: string]: unknown;
}

export interface SapInvoice {
  DocEntry: number;
  DocNum: number;
  CardCode: string;
  DocDate: string;
  DocDueDate?: string;
  DocTotal: number | string;
  Cancelled?: string;
  UpdateDate?: string;
}

export interface SapPayment {
  DocEntry: number;
  DocNum: number;
  CardCode: string;
  DocDate: string;
  Cancelled?: string;
  CashSum?: number | string;
  TransferSum?: number | string;
  PaymentChecks?: { CheckSum?: number | string }[];
  PaymentCreditCards?: { CreditSum?: number | string }[];
  PaymentInvoices?: { DocEntry: number; InvoiceType?: string }[];
  UpdateDate?: string;
}

/** What SAP's mappings add to the books' common ones. */
export interface SapMapping extends ErpMapping {
  /** A user field on items holding the GST rate. */
  taxRateField: string | null;
  /** The GST rate of an item whose field is empty, as a decimal string. */
  defaultTaxRate: string | null;
}

const text = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value).trim();
const yes = (value: unknown) => text(value) === 'tYES';
/** A SAP date, whether it comes as a date or a moment. */
const day = (value: unknown) => text(value).slice(0, 10);

/**
 * A customer as an account of the mapped type (BR-60): the code is the CardCode, the territory a
 * user field the mapping names, else the account's present one, else the default; the address is
 * the bill-to address. A frozen or invalid partner is inactive. Only customers are read.
 */
export function sapCustomerRow(
  partner: SapBusinessPartner,
  mapping: ErpMapping,
  presentTerritory: string | null,
): ErpMapped {
  const code = text(partner.CardCode);
  if (!code) return { issue: 'no_customer_number' };
  if (!mapping.accountType) return { issue: 'no_account_type' };
  const territory =
    (mapping.territoryField ? text(partner[mapping.territoryField]) : '') ||
    presentTerritory ||
    text(mapping.defaultTerritory);
  if (!territory) return { issue: 'no_territory' };
  const addresses = partner.BPAddresses ?? [];
  const address =
    addresses.find((entry) => entry.AddressType === 'bo_BillTo') ?? addresses[0] ?? {};
  return {
    row: {
      code,
      name: text(partner.CardName),
      territory_code: territory,
      address: [text(address.Street), text(address.Block)].filter(Boolean).join(', '),
      city: text(address.City),
      state: text(address.State),
      pin: text(address.ZipCode),
      active: yes(partner.Frozen) || partner.Valid === 'tNO' ? 'no' : 'yes',
    },
  };
}

/**
 * An item of the catalogue (BR-60): the code is the ItemCode, the product its group's name (else
 * its own), the unit the sales unit (else the inventory unit), through the unit mapping; the GST
 * rate is the mapped user field, else the default; the price is the given list's.
 */
export function sapItemRow(
  item: SapItem,
  mapping: SapMapping,
  groupName: string | null,
  price: { rate: number | string | null | undefined; list: string },
): ErpMapped {
  const code = text(item.ItemCode);
  if (!code) return { issue: 'no_sku' };
  const taxRate =
    (mapping.taxRateField ? text(item[mapping.taxRateField]) : '') || text(mapping.defaultTaxRate);
  if (!taxRate) return { issue: 'no_tax_rate' };
  const unit = text(item.SalesUnit) || text(item.InventoryUOM);
  return {
    row: {
      item_code: code,
      item_name: text(item.ItemName),
      product_name: text(groupName) || text(item.ItemName),
      base_unit: mapping.units[unit] ?? unit,
      hsn: text(item.ChapterID === -1 ? '' : item.ChapterID),
      tax_rate: taxRate,
      price: price.rate === null || price.rate === undefined ? '' : decimalCell(price.rate),
      price_list: price.list,
      active: yes(item.Frozen) || item.Valid === 'tNO' ? 'no' : 'yes',
    },
  };
}

/** An A/R invoice (BR-51, BR-60): its number, the customer's code, and cancelled ones cancelled. */
export function sapInvoiceRow(invoice: SapInvoice, linked: boolean): ErpMapped {
  if (!linked) return { issue: 'unknown_customer' };
  return {
    row: {
      number: String(invoice.DocNum),
      account_code: text(invoice.CardCode),
      date: day(invoice.DocDate),
      amount: decimalCell(invoice.DocTotal),
      due_date: day(invoice.DocDueDate),
      status: yes(invoice.Cancelled) ? 'cancelled' : 'open',
    },
  };
}

/** What a payment came to, in every way it was paid, exactly as paise. */
export function sapPaymentTotal(payment: SapPayment): string {
  const paise = (value: unknown) => {
    const cell = decimalCell(value as number | string | undefined) || '0';
    const [whole = '0', part = ''] = cell.replace('-', '').split('.');
    const amount = BigInt(whole) * 100n + BigInt((part + '00').slice(0, 2));
    return cell.startsWith('-') ? -amount : amount;
  };
  const total =
    paise(payment.CashSum) +
    paise(payment.TransferSum) +
    (payment.PaymentChecks ?? []).reduce((sum, check) => sum + paise(check.CheckSum), 0n) +
    (payment.PaymentCreditCards ?? []).reduce((sum, card) => sum + paise(card.CreditSum), 0n);
  const digits = (total < 0n ? -total : total).toString().padStart(3, '0');
  return `${total < 0n ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/**
 * An incoming payment as a receipt (BR-51, BR-60), against the invoices it was applied to, named
 * by their numbers; a cancelled payment is cancelled.
 */
export function sapPaymentRow(
  payment: SapPayment,
  linked: boolean,
  invoiceNumberOf: (docEntry: number) => string | null,
): ErpMapped {
  if (!linked) return { issue: 'unknown_customer' };
  return {
    row: {
      number: String(payment.DocNum),
      account_code: text(payment.CardCode),
      date: day(payment.DocDate),
      amount: sapPaymentTotal(payment),
      kind: 'receipt',
      against: (payment.PaymentInvoices ?? [])
        .filter((applied) => !applied.InvoiceType || applied.InvoiceType === 'it_Invoice')
        .map((applied) => invoiceNumberOf(applied.DocEntry))
        .filter((number): number is string => Boolean(number))
        .join(', '),
      status: yes(payment.Cancelled) ? 'cancelled' : 'open',
    },
  };
}
