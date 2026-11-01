/**
 * Schemes and promotions on orders (BR-55, decision D127) as pure functions: the server prices
 * with them, and the phone and the order desk preview the same figures. Amounts are decimal
 * strings, worked out exactly; nothing here uses binary floating point.
 */
import { divide, type PricedLine, scaled, unscaled } from './pricing';

export const SCHEME_KINDS = ['percentage', 'flat_per_unit', 'slabs', 'free_goods'] as const;
export type SchemeKind = (typeof SCHEME_KINDS)[number];

/** At most this many slabs in a scheme. */
export const SCHEME_MAX_SLABS = 10;

export interface SchemeSlab {
  /** Base units of the scheme's lines in the order from which the slab applies. */
  from: string;
  /** Percent, up to 4 places. */
  percent: string;
}

/** What a scheme gives; which fields it uses follows its kind. */
export interface SchemeRule {
  /** `percentage`: percent off the line's taxable, up to 4 places. */
  percent?: string;
  /** `flat_per_unit`: an amount off each base unit, 2 places. */
  amount?: string;
  /** `slabs`: percent off by the base units ordered, ascending by `from`. */
  slabs?: readonly SchemeSlab[];
  /** `free_goods`: for every `buy` base units of the line, `get` base units free. */
  buy?: string;
  get?: string;
  /** `free_goods`: the item given free; the line's own item when null. */
  freeItemId?: string | null;
}

export interface SchemeRef {
  id: string;
  key: string;
  kind: SchemeKind;
  rule: SchemeRule;
  /** Empty means any; an item matches when it or its category is named. */
  itemIds: readonly string[];
  categoryIds: readonly string[];
  /** Empty means any account type. */
  accountTypeKeys: readonly string[];
  /** Empty means anywhere; an account matches in a named territory or one under it. */
  territoryIds: readonly string[];
  /** Calendar dates on the tenant's clock, both included. */
  validFrom: string;
  validTo: string | null;
  active: boolean;
}

export interface SchemeAccount {
  type: string;
  /** The account's territory first, then each one above it. */
  territories: readonly string[];
}

export interface SchemeItem {
  itemId: string;
  categoryId: string | null;
}

/** A priced order line, before any scheme. */
export interface SchemeLine extends SchemeItem {
  baseUnits: string;
  taxable: string;
}

/** BR-55: whether a scheme reaches an item for an account on a date. */
export function schemeApplies(
  scheme: SchemeRef,
  item: SchemeItem,
  account: SchemeAccount,
  date: string,
): boolean {
  if (!scheme.active || date < scheme.validFrom || (scheme.validTo && date > scheme.validTo)) {
    return false;
  }
  const narrowed = scheme.itemIds.length > 0 || scheme.categoryIds.length > 0;
  if (
    narrowed &&
    !scheme.itemIds.includes(item.itemId) &&
    !(item.categoryId && scheme.categoryIds.includes(item.categoryId))
  ) {
    return false;
  }
  if (scheme.accountTypeKeys.length > 0 && !scheme.accountTypeKeys.includes(account.type)) {
    return false;
  }
  return (
    scheme.territoryIds.length === 0 ||
    account.territories.some((territory) => scheme.territoryIds.includes(territory))
  );
}

/** What a scheme gives one line: an amount off its taxable, and goods free. */
export interface SchemeBenefit {
  discount: string;
  free: { itemId: string; baseUnits: string } | null;
}

const percentOf = (taxable: string, percent: string) =>
  unscaled(divide(scaled(taxable, 2) * scaled(percent, 4), 1_000_000n), 2);

/**
 * BR-55: what a scheme gives a line. `covered` is the base units of every line of the order the
 * scheme reaches, which picks a slab; free goods count the line's own base units.
 */
export function schemeBenefit(scheme: SchemeRef, line: SchemeLine, covered: string): SchemeBenefit {
  const { rule } = scheme;
  switch (scheme.kind) {
    case 'percentage':
      return { discount: percentOf(line.taxable, rule.percent ?? '0'), free: null };
    case 'flat_per_unit': {
      const off = divide(scaled(rule.amount ?? '0', 2) * scaled(line.baseUnits, 3), 1000n);
      const taxable = scaled(line.taxable, 2);
      return { discount: unscaled(off > taxable ? taxable : off, 2), free: null };
    }
    case 'slabs': {
      const units = scaled(covered, 3);
      const reached = [...(rule.slabs ?? [])]
        .filter((slab) => scaled(slab.from, 3) <= units)
        .sort((a, b) => (scaled(b.from, 3) > scaled(a.from, 3) ? 1 : -1))[0];
      return { discount: reached ? percentOf(line.taxable, reached.percent) : '0.00', free: null };
    }
    case 'free_goods': {
      const buy = scaled(rule.buy ?? '0', 3);
      if (buy === 0n) return { discount: '0.00', free: null };
      const times = scaled(line.baseUnits, 3) / buy;
      const units = times * scaled(rule.get ?? '0', 3);
      return {
        discount: '0.00',
        free:
          units > 0n
            ? { itemId: rule.freeItemId ?? line.itemId, baseUnits: unscaled(units, 3) }
            : null,
      };
    }
  }
}

/** A line's scheme, chosen. */
export interface ChosenScheme {
  scheme: SchemeRef;
  benefit: SchemeBenefit;
}

/**
 * BR-55: the one scheme best for the customer on each line: the largest discount plus the value of
 * its free goods at `freeRate` (the free item's net rate for the account, or nothing). Ties go to
 * the scheme valid from earlier, then the lower key, so every device chooses the same one.
 */
export function chooseSchemes(
  schemes: readonly SchemeRef[],
  lines: readonly SchemeLine[],
  account: SchemeAccount,
  date: string,
  freeRate: (itemId: string) => string | null,
): (ChosenScheme | null)[] {
  const reaching = (scheme: SchemeRef) =>
    lines.filter((line) => schemeApplies(scheme, line, account, date));
  const covered = new Map(
    schemes.map((scheme) => [
      scheme.id,
      unscaled(
        reaching(scheme).reduce((sum, line) => sum + scaled(line.baseUnits, 3), 0n),
        3,
      ),
    ]),
  );
  const worth = (benefit: SchemeBenefit): bigint => {
    let value = scaled(benefit.discount, 2);
    if (benefit.free) {
      const rate = freeRate(benefit.free.itemId);
      if (rate) value += divide(scaled(rate, 2) * scaled(benefit.free.baseUnits, 3), 1000n);
    }
    return value;
  };
  return lines.map((line) => {
    let best: (ChosenScheme & { value: bigint }) | null = null;
    for (const scheme of schemes) {
      if (!schemeApplies(scheme, line, account, date)) continue;
      const benefit = schemeBenefit(scheme, line, covered.get(scheme.id)!);
      const value = worth(benefit);
      // Goods free with no price for the account still count, worth nothing beside the rest.
      if (value === 0n && !benefit.free) continue;
      const better =
        !best ||
        value > best.value ||
        (value === best.value &&
          (scheme.validFrom < best.scheme.validFrom ||
            (scheme.validFrom === best.scheme.validFrom && scheme.key < best.scheme.key)));
      if (better) best = { scheme, benefit, value };
    }
    return best ? { scheme: best.scheme, benefit: best.benefit } : null;
  });
}

/**
 * BR-55 with BR-12: a priced line after its scheme's discount. The discount comes off the taxable
 * before tax, so tax and total follow the lower value.
 */
export function afterScheme(
  line: Pick<PricedLine, 'taxable'>,
  discount: string,
  taxRate: string,
): { taxable: string; tax: string; total: string } {
  const taxable = scaled(line.taxable, 2) - scaled(discount, 2);
  const tax = divide(taxable * scaled(taxRate, 4), 1_000_000n);
  return {
    taxable: unscaled(taxable, 2),
    tax: unscaled(tax, 2),
    total: unscaled(taxable + tax, 2),
  };
}

/** Why a scheme's rule can't be saved, by field, or an empty list. */
export function schemeRuleIssues(
  kind: SchemeKind,
  rule: SchemeRule,
): { path: string; issue: string }[] {
  const issues: { path: string; issue: string }[] = [];
  const positive = (path: string, value: string | undefined, places: number) => {
    if (!value || scaled(value, places) === 0n) issues.push({ path, issue: 'Give more than 0' });
  };
  switch (kind) {
    case 'percentage':
      positive('rule.percent', rule.percent, 4);
      if (rule.percent && scaled(rule.percent, 4) > 1_000_000n) {
        issues.push({ path: 'rule.percent', issue: 'Give 100 or less' });
      }
      break;
    case 'flat_per_unit':
      positive('rule.amount', rule.amount, 2);
      break;
    case 'slabs': {
      const slabs = rule.slabs ?? [];
      if (slabs.length === 0) issues.push({ path: 'rule.slabs', issue: 'Add a slab' });
      slabs.forEach((slab, index) => {
        positive(`rule.slabs.${index}.from`, slab.from, 3);
        positive(`rule.slabs.${index}.percent`, slab.percent, 4);
        const before = slabs[index - 1];
        if (before && scaled(slab.from, 3) <= scaled(before.from, 3)) {
          issues.push({ path: `rule.slabs.${index}.from`, issue: 'Start above the slab before' });
        }
        if (before && scaled(slab.percent, 4) <= scaled(before.percent, 4)) {
          issues.push({
            path: `rule.slabs.${index}.percent`,
            issue: 'Give more than the slab before',
          });
        }
      });
      break;
    }
    case 'free_goods':
      positive('rule.buy', rule.buy, 3);
      positive('rule.get', rule.get, 3);
      break;
  }
  return issues;
}

/** A priced line for `schemeCart()`: what BR-10 to BR-12 gave, before any scheme. */
export interface CartLine extends SchemeLine {
  taxRate: string;
  tax: string;
  total: string;
}

/**
 * BR-55 for the apps: a cart's lines with each one's scheme, its discount, and the taxable, tax
 * and total after it, plus the goods given free, as the server will work them out and as the
 * order should quote them (`quoted.scheme`, `free`).
 */
export function schemeCart<L extends CartLine>(
  lines: readonly L[],
  schemes: readonly SchemeRef[],
  account: SchemeAccount,
  date: string,
  freeRate: (itemId: string) => string | null,
): {
  lines: (L & {
    chosen: ChosenScheme | null;
    schemeDiscount: string;
    quoted: { key: string; discount: string } | null;
  })[];
  free: { itemId: string; baseUnits: string; ofItemId: string }[];
} {
  const chosen = chooseSchemes(schemes, lines, account, date, freeRate);
  return {
    lines: lines.map((line, at) => {
      const scheme = chosen[at] ?? null;
      const discount = scheme?.benefit.discount ?? '0.00';
      return {
        ...line,
        ...(scheme ? afterScheme(line, discount, line.taxRate) : {}),
        chosen: scheme,
        schemeDiscount: discount,
        quoted: scheme ? { key: scheme.scheme.key, discount } : null,
      };
    }),
    free: chosen.flatMap((scheme, at) =>
      scheme?.benefit.free ? [{ ...scheme.benefit.free, ofItemId: lines[at]!.itemId }] : [],
    ),
  };
}
