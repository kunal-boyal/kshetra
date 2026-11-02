import { decimalCell, type ErpMapped, type ErpMapping } from './erp';

/**
 * Tally by file exchange (module M20, BR-61, decision D129): what a connection reads of the XML
 * Tally exports (its masters and Day Book), as rows of the product's own import targets, as Zoho's
 * and SAP's records are (BR-59, BR-60). The cell never reaches Tally; an admin uploads the files.
 * The shapes are what `TallyFile` reads from the XML; docs/integrations/tally.md says what is to be
 * confirmed on a real export.
 */

/** A group of ledgers; `parent` is empty, or Tally's word for the top, at the top. */
export interface TallyGroup {
  name: string;
  parent: string;
}

/** A voucher type, whose parent says what kind of voucher a renamed type is. */
export interface TallyVoucherType {
  name: string;
  parent: string;
}

export interface TallyLedger {
  guid: string;
  name: string;
  /** Its other names, which is where Tally users keep a customer's code. */
  aliases: string[];
  parent: string;
  alterId: string;
  address: string[];
  state: string;
  pincode: string;
}

/** A dated GST rate of a stock item, as its GST details give it. */
export interface TallyGstDetail {
  /** YYYYMMDD, or empty for from the start. */
  from: string;
  hsn: string;
  /** The integrated rate, as Tally writes it; null when none is given. */
  rate: string | null;
}

/** A stock item's rate at a price level from a day. */
export interface TallyPrice {
  level: string;
  /** YYYYMMDD. */
  date: string;
  /** As Tally writes a rate: `450.00/Nos`. */
  rate: string;
}

export interface TallyStockItem {
  guid: string;
  name: string;
  aliases: string[];
  /** Its stock group, which becomes the product. */
  parent: string;
  alterId: string;
  baseUnits: string;
  gst: TallyGstDetail[];
  prices: TallyPrice[];
}

/** A bill a voucher's party entry raises or settles. */
export interface TallyBill {
  name: string;
  /** New Ref, Agst Ref, Advance or On Account. */
  type: string;
  amount: string;
  /** A sale's credit period, as Tally writes it: `30 Days`. */
  creditPeriod: string;
}

export interface TallyVoucher {
  guid: string;
  /** Its voucher type's name, which may be one the company renamed. */
  type: string;
  /** YYYYMMDD. */
  date: string;
  number: string;
  party: string;
  reference: string;
  cancelled: boolean;
  /** The party's ledger entry, signed as Tally writes it (a debit negative). */
  partyAmount: string;
  bills: TallyBill[];
}

/** What Tally's mappings add to the books' common ones. */
export interface TallyMapping extends ErpMapping {
  /** Groups whose ledgers are customers, with every group under them. */
  debtorGroups: readonly string[];
  /** A group's name to the territory code its customers belong to. */
  groupTerritories: Readonly<Record<string, string>>;
  /** The GST rate of a stock item whose details give none, as a decimal string. */
  defaultTaxRate: string | null;
  /** Voucher types read as sales and receipts, with every type under them. */
  salesTypes: readonly string[];
  receiptTypes: readonly string[];
}

const text = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value).trim();

/** An amount as Tally writes it (`-1180.00`), exact, without its sign; empty when it isn't one. */
export function tallyNumber(value: string): string {
  const match = /^\s*(-?)\s*(\d+(?:\.\d+)?)\s*$/.exec(value.replace(/,/g, ''));
  if (!match) return '';
  return decimalCell(match[2]);
}

/** Whether Tally's amount is a debit, which it writes negative. */
export function tallyDebit(value: string): boolean {
  return /^\s*-/.test(value);
}

/** A quantity with its unit (` 12.500 Kgs`), as the number and the unit. */
export function tallyQuantity(value: string): { quantity: string; unit: string } | null {
  const match = /^\s*-?\s*(\d+(?:\.\d+)?)\s*([^\d\s=][^=]*?)?\s*(?:=.*)?$/.exec(
    value.replace(/,/g, ''),
  );
  if (!match) return null;
  return { quantity: decimalCell(match[1]), unit: text(match[2]) };
}

/** A rate per unit (`450.00/Nos`), as the amount and the unit. */
export function tallyRate(value: string): { rate: string; unit: string } | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*([^=]*?))?\s*(?:=.*)?$/.exec(
    value.replace(/,/g, ''),
  );
  if (!match) return null;
  return { rate: decimalCell(match[1]), unit: text(match[2]) };
}

/** A Tally date (YYYYMMDD) as an ISO date; empty when it isn't one. */
export function tallyDate(value: string): string {
  const match = /^\s*(\d{4})(\d{2})(\d{2})\s*$/.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/**
 * Whether a name is one of the given roots, or under one through its parents (BR-61): a ledger's
 * group under Sundry Debtors, or a voucher type under Sales. Parents not in the file end the walk.
 */
export function tallyUnder(
  name: string,
  roots: readonly string[],
  parents: ReadonlyMap<string, string>,
): boolean {
  const wanted = new Set(roots.map((root) => root.toLowerCase()));
  const visited = new Set<string>();
  let current = name;
  while (current && !visited.has(current.toLowerCase())) {
    if (wanted.has(current.toLowerCase())) return true;
    visited.add(current.toLowerCase());
    current = parents.get(current) ?? '';
  }
  return false;
}

/** The nearest group, from the ledger's own up, that the mapping gives a territory. */
function territoryOf(
  group: string,
  mapping: TallyMapping,
  parents: ReadonlyMap<string, string>,
): string {
  const territories = new Map(
    Object.entries(mapping.groupTerritories).map(([name, code]) => [name.toLowerCase(), code]),
  );
  const visited = new Set<string>();
  let current = group;
  while (current && !visited.has(current.toLowerCase())) {
    const code = territories.get(current.toLowerCase());
    if (code) return code;
    visited.add(current.toLowerCase());
    current = parents.get(current) ?? '';
  }
  return '';
}

/** An account code as accounts take it: up to 40 letters, digits, dots, dashes or slashes. */
const ACCOUNT_CODE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/;

/**
 * A ledger of the debtor groups as an account of the mapped type (BR-61): the code is its first
 * alias that is a valid account code (Kunal's choice, 2026-11-02), never made from its name; the
 * territory comes from its group, else the account's present one, else the default. Null for a
 * ledger outside the debtor groups.
 */
export function tallyCustomerRow(
  ledger: TallyLedger,
  mapping: TallyMapping,
  groups: ReadonlyMap<string, string>,
  presentTerritory: string | null,
): ErpMapped | null {
  if (!tallyUnder(ledger.parent, mapping.debtorGroups, groups)) return null;
  const code = ledger.aliases.map(text).find((alias) => ACCOUNT_CODE.test(alias));
  if (!code) return { issue: 'no_customer_number' };
  if (!mapping.accountType) return { issue: 'no_account_type' };
  const territory =
    territoryOf(ledger.parent, mapping, groups) ||
    presentTerritory ||
    text(mapping.defaultTerritory);
  if (!territory) return { issue: 'no_territory' };
  return {
    row: {
      code,
      name: text(ledger.name),
      territory_code: territory,
      address: ledger.address.map(text).filter(Boolean).join(', '),
      state: text(ledger.state),
      pin: text(ledger.pincode),
    },
  };
}

/** The GST detail in force on a day (YYYY-MM-DD): the latest from on or before it. */
function gstOn(details: readonly TallyGstDetail[], today: string): TallyGstDetail | null {
  const day = today.replace(/-/g, '');
  return (
    [...details]
      .filter((detail) => !detail.from || detail.from <= day)
      .sort((a, b) => a.from.localeCompare(b.from))
      .at(-1) ?? null
  );
}

/** A stock item's rate at a price level on a day: the latest dated on or before it. */
export function tallyPriceOn(item: TallyStockItem, level: string, today: string): string | null {
  const day = today.replace(/-/g, '');
  const price = item.prices
    .filter((entry) => entry.level.toLowerCase() === level.toLowerCase() && entry.date <= day)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  return price ? (tallyRate(price.rate)?.rate ?? null) : null;
}

/** A stock item's code: its first alias that fits an item code, never its name. */
export function tallyItemCode(item: TallyStockItem): string | null {
  return item.aliases.map(text).find((alias) => alias.length > 0 && alias.length <= 40) ?? null;
}

/**
 * A stock item of the catalogue (BR-61): the code is its first alias, the product its stock
 * group, the unit its base unit through the unit mapping, HSN and the GST rate from the details in
 * force today, else the default rate; the price is the given level's rate on that day.
 */
export function tallyItemRow(
  item: TallyStockItem,
  mapping: TallyMapping,
  today: string,
  price: { level: string | null; list: string },
): ErpMapped {
  const code = tallyItemCode(item);
  if (!code) return { issue: 'no_sku' };
  const gst = gstOn(item.gst, today);
  const taxRate = (gst?.rate ? tallyNumber(gst.rate) : '') || text(mapping.defaultTaxRate);
  if (!taxRate) return { issue: 'no_tax_rate' };
  const unit = text(item.baseUnits);
  const group = text(item.parent);
  const rate = price.level ? tallyPriceOn(item, price.level, today) : null;
  return {
    row: {
      item_code: code,
      item_name: text(item.name),
      product_name: group && !/primary$/i.test(group) ? group : text(item.name),
      base_unit: mapping.units[unit] ?? unit,
      hsn: text(gst?.hsn),
      tax_rate: taxRate,
      price: rate ?? '',
      price_list: price.list,
    },
  };
}

/** Days added to an ISO date. */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** What kind of voucher this is to a connection, by its type and the types above it. */
export function tallyVoucherKind(
  voucher: TallyVoucher,
  mapping: TallyMapping,
  types: ReadonlyMap<string, string>,
): 'sale' | 'receipt' | null {
  if (tallyUnder(voucher.type, mapping.salesTypes, types)) return 'sale';
  if (tallyUnder(voucher.type, mapping.receiptTypes, types)) return 'receipt';
  return null;
}

/**
 * A sales voucher as an invoice of its party's account (BR-51, BR-61): its number, day and the
 * party's amount; due after the credit period its bill gives; cancelled ones cancelled.
 */
export function tallyInvoiceRow(voucher: TallyVoucher, accountCode: string | null): ErpMapped {
  if (!accountCode) return { issue: 'unknown_customer' };
  const date = tallyDate(voucher.date);
  const period = /^\s*(\d+)\s*Days?\s*$/i.exec(voucher.bills[0]?.creditPeriod ?? '');
  return {
    row: {
      number: text(voucher.number),
      account_code: accountCode,
      date,
      amount: tallyNumber(voucher.partyAmount),
      due_date: period && date ? addDays(date, Number(period[1])) : '',
      status: voucher.cancelled ? 'cancelled' : 'open',
    },
  };
}

/**
 * A receipt voucher as a receipt (BR-51, BR-61), settling the bills its Agst Ref allocations
 * name, which are the invoices' numbers; the rest stays on account.
 */
export function tallyReceiptRow(voucher: TallyVoucher, accountCode: string | null): ErpMapped {
  if (!accountCode) return { issue: 'unknown_customer' };
  return {
    row: {
      number: text(voucher.number),
      account_code: accountCode,
      date: tallyDate(voucher.date),
      amount: tallyNumber(voucher.partyAmount),
      kind: 'receipt',
      against: voucher.bills
        .filter((bill) => /^agst\s*ref$/i.test(text(bill.type)) && text(bill.name))
        .map((bill) => text(bill.name))
        .join(', '),
      status: voucher.cancelled ? 'cancelled' : 'open',
    },
  };
}
