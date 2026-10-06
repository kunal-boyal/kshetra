import { z } from 'zod';

/** The languages all configuration text is written in at launch (spec 0, rule 9). */
export const LOCALES = ['en', 'hi'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * The shape of every configuration key. Spec 5.6 sets it for form fields; account types, forms,
 * metrics, roles, designations, slots, segments and options use it too. A key never changes once
 * records refer to it.
 */
export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const Key = z
  .string()
  .regex(KEY_PATTERN, 'Use 1–40 lowercase letters, digits or underscores, starting with a letter')
  .meta({ id: 'Key' });

/** A Lucide icon name (decision D18), such as `map-pin`. */
export const IconName = z
  .string()
  .max(60)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'Use a Lucide icon name, such as map-pin')
  .meta({ id: 'IconName' });

function phrase(max: number) {
  return z
    .string()
    .max(max)
    .regex(/^\S(?:[\s\S]*\S)?$/, 'Fill this in, without spaces at either end');
}

/** Text in every launch language, each at most `max` characters long. */
export function localizedText(max: number) {
  return z.strictObject({ en: phrase(max), hi: phrase(max) });
}

/** A label, an option or a short name, in every launch language. */
export const LocalizedText = localizedText(120).meta({ id: 'LocalizedText' });

/** A noun's singular and plural, as `Intl.PluralRules` names them: "1 visit", "3 visits". */
export const NounForms = z.strictObject({ one: phrase(60), other: phrase(60) });

/**
 * A noun in every launch language. Its forms are named after the plural categories of
 * `Intl.PluralRules`, so a count picks the right one: "1 visit", "3 visits".
 */
export const LocalizedNoun = z
  .strictObject({ en: NounForms, hi: NounForms })
  .meta({ id: 'LocalizedNoun' });

/**
 * An amount of money as a decimal string with at most two decimals, such as `"1250.50"`. Money
 * never passes through binary floating point (spec 10.1).
 */
export const Money = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/, 'Write an amount such as 1250 or 1250.50')
  .meta({ id: 'Money' });

/** A `Money` string in hundredths of the currency unit, for exact comparison. */
export function toMinorUnits(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/** The indexes of values that already appeared earlier in the list. */
export function repeats(values: readonly string[]): number[] {
  const seen = new Set<string>();
  return values.flatMap((value, index) => {
    if (seen.has(value)) return [index];
    seen.add(value);
    return [];
  });
}
