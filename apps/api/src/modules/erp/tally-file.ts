import { DOMParser, type Element } from '@xmldom/xmldom';
import type {
  TallyBill,
  TallyGroup,
  TallyGstDetail,
  TallyLedger,
  TallyPrice,
  TallyStockItem,
  TallyVoucher,
  TallyVoucherType,
} from '@thelamp/shared';

/** One master or voucher's XML; Tally's own are a few kilobytes, a big price list a few hundred. */
const MESSAGE_MAX_CHARS = 2_000_000;
const OPEN = '<TALLYMESSAGE';
const CLOSE = '</TALLYMESSAGE>';

/** Why a file isn't one a connection reads, in words the admin can act on (BR-61). */
export type TallyFileIssue = 'not_tally' | 'declarations' | 'unreadable' | 'too_large_part';

export class TallyFileRefused extends Error {
  constructor(readonly issue: TallyFileIssue) {
    super(`Not a Tally export: ${issue}`);
  }
}

/** Everything a connection reads of one export: its masters and its vouchers. */
export interface TallyFileContents {
  company: string | null;
  groups: TallyGroup[];
  voucherTypes: TallyVoucherType[];
  ledgers: TallyLedger[];
  stockItems: TallyStockItem[];
  vouchers: TallyVoucher[];
}

/**
 * The file's text, whichever way Tally wrote it: UTF-8, or UTF-16 with its byte-order mark (or
 * without one, told by the zero bytes of ASCII), with the control characters Tally writes as
 * character references (`&#4;`), which XML 1.0 forbids, taken out.
 */
export function tallyText(bytes: Uint8Array): string {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
  else if (bytes.length > 1 && bytes[0] !== 0 && bytes[1] === 0) {
    text = new TextDecoder('utf-16le').decode(bytes);
  } else text = new TextDecoder('utf-8').decode(bytes);
  // The decoder drops the byte-order mark itself.
  const referenced = text.replace(
    /&#(?:x([0-9a-f]+)|(\d+));/gi,
    (whole, hex: string | undefined, dec: string) =>
      control(hex ? parseInt(hex, 16) : Number(dec)) ? '' : whole,
  );
  let kept = '';
  let from = 0;
  for (let index = 0; index < referenced.length; index += 1) {
    if (!control(referenced.charCodeAt(index))) continue;
    kept += referenced.slice(from, index);
    from = index + 1;
  }
  return from === 0 ? referenced : kept + referenced.slice(from);
}

/** A control character XML 1.0 forbids: below a space, but tab, line feed and carriage return. */
const control = (code: number) => code < 32 && code !== 9 && code !== 10 && code !== 13;

/**
 * Checks a file is a Tally export before it is kept, and names its company: an envelope of
 * messages, with no DOCTYPE or entity declarations, which parsing never resolves anyway.
 */
export function checkTallyFile(text: string): { company: string | null } {
  if (/<!DOCTYPE|<!ENTITY|<!ELEMENT|<!ATTLIST/i.test(text)) {
    throw new TallyFileRefused('declarations');
  }
  if (!/<ENVELOPE[\s>]/.test(text) || !text.includes(OPEN)) throw new TallyFileRefused('not_tally');
  const match = /<SVCURRENTCOMPANY>([^<]*)<\/SVCURRENTCOMPANY>/.exec(text);
  return { company: match ? unescape(match[1]!).trim() || null : null };
}

/** The five entities XML predefines, and numeric references, as text. */
function unescape(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** A Tally export's masters and vouchers (BR-61), a message at a time so memory stays bounded. */
export function readTallyFile(bytes: Uint8Array): TallyFileContents {
  const text = tallyText(bytes);
  const { company } = checkTallyFile(text);
  const contents: TallyFileContents = {
    company,
    groups: [],
    voucherTypes: [],
    ledgers: [],
    stockItems: [],
    vouchers: [],
  };
  for (const element of messages(text)) {
    switch (element.tagName) {
      case 'GROUP':
        contents.groups.push({ name: nameOf(element), parent: value(element, 'PARENT') });
        break;
      case 'VOUCHERTYPE':
        contents.voucherTypes.push({ name: nameOf(element), parent: value(element, 'PARENT') });
        break;
      case 'LEDGER':
        contents.ledgers.push(ledger(element));
        break;
      case 'STOCKITEM':
        contents.stockItems.push(stockItem(element));
        break;
      case 'VOUCHER':
        contents.vouchers.push(voucher(element));
        break;
      default:
        // Units, godowns, cost centres and the rest are none of a connection's business.
        break;
    }
  }
  return contents;
}

/** Each master or voucher, parsed on its own. */
function* messages(text: string): Generator<Element> {
  const parser = new DOMParser({
    onError: (level) => {
      if (level !== 'warning') throw new TallyFileRefused('unreadable');
    },
  });
  for (let start = text.indexOf(OPEN); start >= 0; start = text.indexOf(OPEN, start)) {
    const end = text.indexOf(CLOSE, start);
    if (end < 0) throw new TallyFileRefused('unreadable');
    if (end - start > MESSAGE_MAX_CHARS) throw new TallyFileRefused('too_large_part');
    const xml = text.slice(start, end + CLOSE.length);
    start = end + CLOSE.length;
    // A message names the UDF prefix itself; one that doesn't is given it, as Tally means it.
    const declared = /^<TALLYMESSAGE[^>]*xmlns:UDF=/.test(xml)
      ? xml
      : xml.replace(OPEN, `${OPEN} xmlns:UDF="TallyUDF"`);
    let root: Element | null;
    try {
      root = parser.parseFromString(declared, 'text/xml').documentElement;
    } catch {
      // The parser wraps what `onError` throws in its own error.
      throw new TallyFileRefused('unreadable');
    }
    if (!root) throw new TallyFileRefused('unreadable');
    yield* elements(root);
  }
}

function* elements(parent: Element): Generator<Element> {
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) yield node as Element;
  }
}

/** The direct children of an element with a tag. */
function all(parent: Element, tag: string): Element[] {
  return [...elements(parent)].filter((element) => element.tagName === tag);
}

function first(parent: Element, tag: string): Element | null {
  return all(parent, tag)[0] ?? null;
}

/** A direct child's text, trimmed; empty when it is missing. */
function value(parent: Element, tag: string): string {
  return (first(parent, tag)?.textContent ?? '').trim();
}

/** Every text of a list such as `ADDRESS.LIST` (its `ADDRESS` children). */
function list(parent: Element, listTag: string, tag: string): string[] {
  return all(parent, listTag).flatMap((entry) =>
    all(entry, tag)
      .map((element) => (element.textContent ?? '').trim())
      .filter(Boolean),
  );
}

/** A master's name: its NAME attribute, else the first of its names. */
function nameOf(element: Element): string {
  return (
    (element.getAttribute('NAME') ?? '').trim() || namesOf(element)[0] || value(element, 'NAME')
  );
}

/** Every name a master goes by, its own first, from `LANGUAGENAME.LIST`. */
function namesOf(element: Element): string[] {
  return all(element, 'LANGUAGENAME.LIST').flatMap((language) =>
    list(language, 'NAME.LIST', 'NAME'),
  );
}

function aliasesOf(element: Element): string[] {
  const name = (element.getAttribute('NAME') ?? '').trim();
  const names = namesOf(element);
  // The first name is the master's own, unless Tally wrote it only as the attribute.
  return names.filter((entry, index) => !(index === 0 || entry === name));
}

function ledger(element: Element): TallyLedger {
  return {
    guid: value(element, 'GUID'),
    name: nameOf(element),
    aliases: aliasesOf(element),
    parent: value(element, 'PARENT'),
    alterId: value(element, 'ALTERID'),
    address: list(element, 'ADDRESS.LIST', 'ADDRESS'),
    state: value(element, 'LEDSTATENAME') || value(element, 'STATENAME'),
    pincode: value(element, 'PINCODE'),
  };
}

function gstDetail(element: Element): TallyGstDetail {
  const rates = all(element, 'STATEWISEDETAILS.LIST').flatMap((state) =>
    all(state, 'RATEDETAILS.LIST').map((rate) => ({
      head: value(rate, 'GSTRATEDUTYHEAD').toLowerCase(),
      rate: value(rate, 'GSTRATE'),
    })),
  );
  const integrated = rates.find(
    (entry) => (entry.head === 'igst' || entry.head === 'integrated tax') && entry.rate,
  );
  return {
    from: value(element, 'APPLICABLEFROM'),
    hsn: value(element, 'HSNCODE'),
    rate: integrated?.rate ?? null,
  };
}

function price(element: Element): TallyPrice | null {
  const first_ = first(element, 'PRICELEVELLIST.LIST');
  const rate = first_ ? value(first_, 'RATE') : '';
  if (!rate) return null;
  return { level: value(element, 'PRICELEVEL'), date: value(element, 'DATE'), rate };
}

function stockItem(element: Element): TallyStockItem {
  return {
    guid: value(element, 'GUID'),
    name: nameOf(element),
    aliases: aliasesOf(element),
    parent: value(element, 'PARENT'),
    alterId: value(element, 'ALTERID'),
    baseUnits: value(element, 'BASEUNITS'),
    gst: all(element, 'GSTDETAILS.LIST').map(gstDetail),
    prices: all(element, 'FULLPRICELIST.LIST')
      .map(price)
      .filter((entry): entry is TallyPrice => entry !== null),
  };
}

function bill(element: Element): TallyBill {
  return {
    name: value(element, 'NAME'),
    type: value(element, 'BILLTYPE'),
    amount: value(element, 'AMOUNT'),
    creditPeriod: value(element, 'BILLCREDITPERIOD'),
  };
}

const yes = (text: string) => text.toLowerCase() === 'yes';

function voucher(element: Element): TallyVoucher {
  const party = value(element, 'PARTYLEDGERNAME');
  const entries = [...all(element, 'LEDGERENTRIES.LIST'), ...all(element, 'ALLLEDGERENTRIES.LIST')];
  // The party's own entry, else the one that raises or settles bills.
  const own =
    entries.find((entry) => value(entry, 'LEDGERNAME') === party) ??
    entries.find((entry) => all(entry, 'BILLALLOCATIONS.LIST').length > 0);
  return {
    guid: value(element, 'GUID'),
    type: value(element, 'VOUCHERTYPENAME') || (element.getAttribute('VCHTYPE') ?? '').trim(),
    date: value(element, 'DATE'),
    number: value(element, 'VOUCHERNUMBER'),
    party: party || (own ? value(own, 'LEDGERNAME') : ''),
    reference: value(element, 'REFERENCE'),
    cancelled: yes(value(element, 'ISCANCELLED')) || yes(value(element, 'ISDELETED')),
    partyAmount: own ? value(own, 'AMOUNT') : '',
    bills: own ? all(own, 'BILLALLOCATIONS.LIST').map(bill) : [],
  };
}
