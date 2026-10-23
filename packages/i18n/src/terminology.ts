import {
  type Locale,
  TERMINOLOGY_KEYS,
  type TerminologyKey,
  type TerminologyOverrides,
  type TermValue,
} from '@thelamp/shared';

/** The product's own words for each term (spec 5.2), until a template or the tenant changes them. */
export const TERMINOLOGY_DEFAULTS: Readonly<Record<Locale, Record<TerminologyKey, TermValue>>> = {
  en: {
    'term.account': { one: 'Account', other: 'Accounts' },
    'term.field_user': { one: 'Field user', other: 'Field users' },
    'term.activity': { one: 'Activity', other: 'Activities' },
    'term.journey_plan': { one: 'Journey plan', other: 'Journey plans' },
    'term.plan_item': { one: 'Planned visit', other: 'Planned visits' },
    'term.target': { one: 'Target', other: 'Targets' },
    'term.order': { one: 'Order', other: 'Orders' },
    'term.punch_in': 'Start day',
    'term.punch_out': 'End day',
  },
  hi: {
    'term.account': { one: 'खाता', other: 'खाते' },
    'term.field_user': { one: 'फ़ील्ड कर्मचारी', other: 'फ़ील्ड कर्मचारी' },
    'term.activity': { one: 'गतिविधि', other: 'गतिविधियाँ' },
    'term.journey_plan': { one: 'यात्रा योजना', other: 'यात्रा योजनाएँ' },
    'term.plan_item': { one: 'नियोजित विज़िट', other: 'नियोजित विज़िट' },
    'term.target': { one: 'लक्ष्य', other: 'लक्ष्य' },
    'term.order': { one: 'ऑर्डर', other: 'ऑर्डर' },
    'term.punch_in': 'दिन शुरू करें',
    'term.punch_out': 'दिन खत्म करें',
  },
};

/** Every term in one language. */
export type ResolvedTerminology = Record<TerminologyKey, TermValue>;

/**
 * Every term in one language: the tenant's word when it has one, else the product's (spec 8.6).
 * Templates arrive as tenant overrides, so an industry's words win over the product's too.
 */
export function resolveTerminology(
  overrides: TerminologyOverrides,
  locale: Locale,
): ResolvedTerminology {
  const keys = Object.keys(TERMINOLOGY_KEYS) as TerminologyKey[];
  return Object.fromEntries(
    keys.map((key) => [key, overrides[key]?.[locale] ?? TERMINOLOGY_DEFAULTS[locale][key]]),
  ) as ResolvedTerminology;
}
