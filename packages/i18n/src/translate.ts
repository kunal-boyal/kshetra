import type { Locale, TerminologyKey, TermValue } from '@kshetra/shared';
import { localeTag } from './format';
import { en, type MessageKey } from './messages/en';
import { hi } from './messages/hi';
import { type ResolvedTerminology, resolveTerminology } from './terminology';

/** A message: one text, or a form for each plural category the launch languages use. */
export type Message = string | { one: string; other: string };

/** Every language's messages. A language may lack keys; they fall back to English (spec 8.6). */
export type Catalogue = { en: Record<MessageKey, Message> } & Partial<
  Record<Exclude<Locale, 'en'>, Partial<Record<MessageKey, Message>>>
>;

export const MESSAGES: Catalogue = { en, hi };

export interface TranslateOptions {
  locale: Locale;
  /** Values for `{name}` placeholders. `count` also picks the plural form. */
  params?: Readonly<Record<string, string | number>>;
  /** The tenant's terms in this locale, from the config bundle; the product's words otherwise. */
  terms?: ResolvedTerminology;
  /** The region that formats numbers, from the tenant's default country. */
  region?: string;
}

const PLACEHOLDER = /\{([a-z][A-Za-z0-9_.]*)((?::[a-z]+)*)\}/g;

/**
 * `one` or `other` for a count, by the language's plural rules (Unicode CLDR); `other` without a
 * count. Written out rather than taken from `Intl.PluralRules`, which Hermes, the JavaScript
 * engine of the Android app, doesn't have. English: one is exactly 1. Hindi: one is 0 to 1.
 */
export function pluralForm(locale: Locale, count: string | number | undefined): 'one' | 'other' {
  if (count === undefined) return 'other';
  const n = Math.abs(Number(count));
  if (!Number.isFinite(n)) return 'other';
  if (locale === 'hi') return n <= 1 ? 'one' : 'other';
  return n === 1 ? 'one' : 'other';
}

/** Lowercases capitalised words for use mid-sentence, leaving acronyms such as "SME" alone. */
function lowerWords(text: string): string {
  return text.replace(/\b[A-Z](?=[a-z])/g, (letter) => letter.toLowerCase());
}

function termText(
  value: TermValue,
  modifiers: readonly string[],
  locale: Locale,
  count: string | number | undefined,
): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (modifiers.includes('other')) text = value.other;
  else if (modifiers.includes('count')) text = value[pluralForm(locale, count)];
  else text = value.one;
  return modifiers.includes('lower') ? lowerWords(text) : text;
}

/** A translator over a catalogue; `translate` uses the product's own. */
export function createTranslator(catalogue: Catalogue) {
  return function translate(key: MessageKey, options: TranslateOptions): string {
    const { locale, params = {}, terms = resolveTerminology({}, locale) } = options;
    const message = catalogue[locale]?.[key] ?? catalogue.en[key];
    const text = typeof message === 'string' ? message : message[pluralForm(locale, params.count)];
    return text.replace(PLACEHOLDER, (whole, name: string, suffix: string) => {
      const modifiers = suffix.split(':').filter(Boolean);
      if (name in terms) {
        return termText(terms[name as TerminologyKey], modifiers, locale, params.count);
      }
      const value = params[name];
      if (value === undefined) return whole;
      return typeof value === 'number'
        ? new Intl.NumberFormat(localeTag(locale, options.region)).format(value)
        : value;
    });
  };
}

/** A message in the user's language, with the tenant's words and the parameters filled in. */
export const translate = createTranslator(MESSAGES);

/** The placeholders a text uses, by name: parameters and terms, without their modifiers. */
export function placeholders(message: Message): string[] {
  const texts = typeof message === 'string' ? [message] : [message.one, message.other];
  return [
    ...new Set(texts.flatMap((text) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!))),
  ].sort();
}
