/**
 * Pricing (spec 5.11, BR-10 to BR-14, BR-17) as pure functions: the server prices every order
 * with them, and the apps call the same ones to show what the server will charge. Amounts are
 * decimal strings, computed exactly as scaled integers, never through binary floating point, and
 * rounded half-up.
 */

/** BR-10: round the net rate per base unit before multiplying, or only the line at the end. */
export const PRICE_ROUNDINGS = ['per_unit_first', 'end'] as const;
export type PriceRounding = (typeof PRICE_ROUNDINGS)[number];

/** BR-13: an order has at most this many lines, and its total stays at or below the limit. */
export const ORDER_MAX_LINES = 200;
export const ORDER_MAX_TOTAL = '10000000000.00';

/** BR-17: an expected net or final price in a file must match within this much. */
export const EXPECTED_PRICE_TOLERANCE = '0.02';

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** A non-negative decimal string as an integer at `places` decimal places, exactly. */
export function scaled(text: string, places: number): bigint {
  const match = DECIMAL.exec(text.trim());
  if (!match) throw new Error(`Not a decimal: ${text}`);
  const part = (match[2] ?? '').replace(/0+$/, '');
  if (part.length > places) throw new Error(`${text} has more than ${places} decimal places`);
  return BigInt(match[1]!) * 10n ** BigInt(places) + BigInt(part.padEnd(places, '0') || '0');
}

/** An integer at `places` decimal places as a decimal string with exactly that many places. */
export function unscaled(value: bigint, places: number): string {
  if (places === 0) return value.toString();
  const digits = value.toString().padStart(places + 1, '0');
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

/** `numerator / denominator`, rounded half-up; both non-negative. */
function divide(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

const TEN = (places: number) => 10n ** BigInt(places);

/** BR-10: the net rate per base unit, `round(price × (1 − discount / 100), 2)`. */
export function netRate(price: string, discount: string): string {
  // price at 2 places × (1 − discount%) at 6 places: 8 places, rounded to 2.
  const multiplier = TEN(6) - scaled(discount, 4);
  return unscaled(divide(scaled(price, 2) * multiplier, TEN(6)), 2);
}

/** BR-11: base units of a quantity in a unit holding `factor` base units, to 3 places. */
export function baseUnits(quantity: string, factor: string): string {
  return unscaled(divide(scaled(quantity, 3) * scaled(factor, 3), TEN(3)), 3);
}

/** BR-11: the physical measure (kg or L) of so many base units, to 3 places. */
export function measureOf(units: string, perBaseUnit: string): string {
  return unscaled(divide(scaled(units, 3) * scaled(perBaseUnit, 6), TEN(6)), 3);
}

export interface LineInput {
  /** Per base unit, from the applicable price list. */
  price: string;
  /** Percent, up to 4 places. */
  discount: string;
  /** Percent, up to 4 places. */
  taxRate: string;
  /** In the chosen unit, up to 3 places. */
  quantity: string;
  /** Base units the chosen unit holds. */
  factor: string;
  /** The item's measure per base unit, when it has one. */
  measurePerBaseUnit?: string | null;
}

export interface PricedLine {
  rate: string;
  baseUnits: string;
  taxable: string;
  tax: string;
  total: string;
  /** The line's kg or L, when the item has a measure. */
  measure: string | null;
}

/** BR-10 to BR-12: one order line's rate, base units, taxable value, tax and total. */
export function priceLine(
  input: LineInput,
  rounding: PriceRounding = 'per_unit_first',
): PricedLine {
  const rate = netRate(input.price, input.discount);
  const units = baseUnits(input.quantity, input.factor);
  // Taxable at 2 places: the rounded rate × base units (2 + 3 places), or the exact rate (8).
  const taxable =
    rounding === 'per_unit_first'
      ? divide(scaled(rate, 2) * scaled(units, 3), TEN(3))
      : divide(
          scaled(input.price, 2) * (TEN(6) - scaled(input.discount, 4)) * scaled(units, 3),
          TEN(9),
        );
  const tax = divide(taxable * scaled(input.taxRate, 4), TEN(6));
  return {
    rate,
    baseUnits: units,
    taxable: unscaled(taxable, 2),
    tax: unscaled(tax, 2),
    total: unscaled(taxable + tax, 2),
    measure: input.measurePerBaseUnit ? measureOf(units, input.measurePerBaseUnit) : null,
  };
}

export interface OrderTotals {
  taxable: string;
  tax: string;
  total: string;
}

/** BR-13: an order's totals, the sums of its lines' rounded values. */
export function orderTotals(
  lines: readonly Pick<PricedLine, 'taxable' | 'tax' | 'total'>[],
): OrderTotals {
  const sum = (key: keyof OrderTotals) =>
    unscaled(
      lines.reduce((total, line) => total + scaled(line[key], 2), 0n),
      2,
    );
  return { taxable: sum('taxable'), tax: sum('tax'), total: sum('total') };
}

/** BR-13: why an order can't be placed as it stands, or null. */
export function orderSizeIssue(
  lines: readonly { itemId: string; total: string }[],
): 'too_many_lines' | 'repeated_item' | 'too_large' | null {
  if (lines.length > ORDER_MAX_LINES) return 'too_many_lines';
  if (new Set(lines.map((line) => line.itemId)).size !== lines.length) return 'repeated_item';
  const total = lines.reduce((sum, line) => sum + scaled(line.total, 2), 0n);
  return total > scaled(ORDER_MAX_TOTAL, 2) ? 'too_large' : null;
}

/** The final price per base unit, tax included: `round(rate × (1 + tax / 100), 2)`. */
export function finalRate(rate: string, taxRate: string): string {
  return unscaled(divide(scaled(rate, 2) * (TEN(6) + scaled(taxRate, 4)), TEN(6)), 2);
}

/**
 * BR-17: an expected net price (the net rate) or final price (with tax) in an import must equal
 * the computed one within 0.02. Null when it does, or which one differs and what it should be.
 */
export function expectedPriceIssue(
  entry: { price: string; discount: string; taxRate: string },
  expected: { net?: string | null; final?: string | null },
): { field: 'net' | 'final'; computed: string } | null {
  const rate = netRate(entry.price, entry.discount);
  const tolerance = scaled(EXPECTED_PRICE_TOLERANCE, 2);
  const far = (given: string, computed: string) => {
    const difference = scaled(given, 2) - scaled(computed, 2);
    return (difference < 0n ? -difference : difference) > tolerance;
  };
  if (expected.net && far(expected.net, rate)) return { field: 'net', computed: rate };
  const final = finalRate(rate, entry.taxRate);
  if (expected.final && far(expected.final, final)) return { field: 'final', computed: final };
  return null;
}

/** Who a price list is for (spec 5.11), from the least specific to the most. */
export const PRICE_LIST_SCOPES = [
  'default',
  'account_type',
  'segment',
  'territory',
  'account',
] as const;
export type PriceListScope = (typeof PRICE_LIST_SCOPES)[number];

export interface PriceListRef {
  id: string;
  scope: PriceListScope;
  /** Account type keys, segment keys, territory IDs or account IDs; empty for the default. */
  targets: readonly string[];
  priority: number;
  /** Calendar dates on the tenant's clock, both included. */
  validFrom: string;
  validTo: string | null;
  active: boolean;
}

export interface PricedAccount {
  id: string;
  type: string;
  segments: readonly string[];
  /** The account's territory first, then each one above it. */
  territories: readonly string[];
}

/**
 * Spec 5.11: the price lists that apply to an account on a date, the most specific first. An
 * account's own list beats its territory's, a nearer territory beats one above it, then segment,
 * account type and the default; between lists equally specific, the higher priority wins, then
 * the one valid from later. An item missing from a list is priced by the next list that has it.
 */
export function applicableLists<T extends PriceListRef>(
  lists: readonly T[],
  account: PricedAccount,
  date: string,
): T[] {
  // Higher ranks are more specific; territories rank by nearness.
  const rank = (list: PriceListRef): number | null => {
    switch (list.scope) {
      case 'account':
        return list.targets.includes(account.id) ? 1000 : null;
      case 'territory': {
        const distance = account.territories.findIndex((id) => list.targets.includes(id));
        return distance < 0 ? null : 999 - distance;
      }
      case 'segment':
        return account.segments.some((segment) => list.targets.includes(segment)) ? 3 : null;
      case 'account_type':
        return list.targets.includes(account.type) ? 2 : null;
      case 'default':
        return 1;
    }
  };
  return lists
    .filter(
      (list) => list.active && list.validFrom <= date && (!list.validTo || date <= list.validTo),
    )
    .flatMap((list) => {
      const specific = rank(list);
      return specific === null ? [] : [{ list, specific }];
    })
    .sort(
      (a, b) =>
        b.specific - a.specific ||
        b.list.priority - a.list.priority ||
        b.list.validFrom.localeCompare(a.list.validFrom) ||
        a.list.id.localeCompare(b.list.id),
    )
    .map(({ list }) => list);
}

export interface PriceEntry {
  price: string;
  discount: string;
}

/** An item's price from the first of the applicable lists that has it, with that list. */
export function priceFor(
  itemId: string,
  lists: readonly PriceListRef[],
  entries: (listId: string, itemId: string) => PriceEntry | undefined,
): (PriceEntry & { listId: string }) | null {
  for (const list of lists) {
    const entry = entries(list.id, itemId);
    if (entry) return { ...entry, listId: list.id };
  }
  return null;
}

/** BR-14: the parts of a quoted line that differ from the server's, by name. */
export function quoteDifferences(
  quoted: { price: string; discount: string; taxRate: string; factor: string },
  current: { price: string; discount: string; taxRate: string; factor: string },
): ('price' | 'discount' | 'taxRate' | 'factor')[] {
  const places = { price: 2, discount: 4, taxRate: 4, factor: 3 } as const;
  return (Object.keys(places) as (keyof typeof places)[]).filter(
    (key) => scaled(quoted[key], places[key]) !== scaled(current[key], places[key]),
  );
}
