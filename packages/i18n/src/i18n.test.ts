import { ERROR_HTTP_STATUS, type ErrorCode, LOCALES } from '@kshetra/shared';
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMoney, formatNumber } from './format';
import { en, type MessageKey } from './messages/en';
import { resolveTerminology, TERMINOLOGY_DEFAULTS } from './terminology';
import { createTranslator, MESSAGES, placeholders, translate, pluralForm } from './translate';

const keys = Object.keys(en) as MessageKey[];

describe('the string tables (spec 8.6)', () => {
  it('give every error code a message in every language (spec 8.4)', () => {
    for (const code of Object.keys(ERROR_HTTP_STATUS) as ErrorCode[]) {
      for (const locale of LOCALES) {
        expect(MESSAGES[locale]?.[`error.${code}`], `${locale} error.${code}`).toBeTruthy();
      }
    }
  });

  it('translate every key into Hindi, with the same placeholders', () => {
    for (const key of keys) {
      const hindi = MESSAGES.hi?.[key];
      expect(hindi, key).toBeDefined();
      expect(placeholders(hindi!), key).toEqual(placeholders(en[key]));
    }
  });

  it('never print an industry word: terms go through placeholders', () => {
    const words = /\b(account|order|target|activit(y|ies)|journey plan|planned visit)s?\b/i;
    for (const key of keys) {
      const message = en[key];
      for (const text of typeof message === 'string' ? [message] : Object.values(message)) {
        // Mentions of the user's own account or a placeholder's name are allowed.
        const bare = text.replace(/\{[^}]*\}/g, '').replace(/your account/gi, '');
        expect(bare, key).not.toMatch(words);
      }
    }
  });

  it('fall back to English for a key a language lacks', () => {
    const partial = createTranslator({ en, hi: { 'error.INTERNAL': 'कुछ गड़बड़ हो गई।' } });
    expect(partial('error.INTERNAL', { locale: 'hi' })).toBe('कुछ गड़बड़ हो गई।');
    expect(partial('error.NOT_FOUND', { locale: 'hi' })).toBe(en['error.NOT_FOUND']);
  });
});

describe('translate', () => {
  it("speaks in the product's words until the tenant has its own", () => {
    expect(translate('error.OUTSIDE_GEOFENCE', { locale: 'en' })).toBe(
      'You are too far from this account.',
    );
    const terms = resolveTerminology(
      {
        'term.account': {
          en: { one: 'Party', other: 'Parties' },
          hi: { one: 'पार्टी', other: 'पार्टियाँ' },
        },
        'term.target': { en: { one: 'KRA', other: 'KRAs' }, hi: { one: 'केआरए', other: 'केआरए' } },
      },
      'en',
    );
    expect(translate('error.OUTSIDE_GEOFENCE', { locale: 'en', terms })).toBe(
      'You are too far from this party.',
    );
    // Acronyms keep their capitals mid-sentence.
    expect(translate('copy.locked_target', { locale: 'en', terms })).toBe(
      'This KRA is locked and can no longer be changed.',
    );
    expect(translate('copy.pending_work', { locale: 'en' })).toBe(
      'Only approved activities count toward your targets.',
    );
  });

  it('uses labels as they are', () => {
    expect(translate('error.NOT_ON_SHIFT', { locale: 'en' })).toBe(
      'You are not on duty. Tap Start day first.',
    );
    expect(translate('error.NOT_ON_SHIFT', { locale: 'hi' })).toBe(
      'आप ड्यूटी पर नहीं हैं। पहले दिन शुरू करें पर टैप करें।',
    );
  });

  it('picks plural forms by the rules of each language', () => {
    expect(translate('sync.waiting', { locale: 'en', params: { count: 1 } })).toBe(
      '1 item is waiting to upload.',
    );
    expect(translate('sync.waiting', { locale: 'en', params: { count: 0 } })).toBe(
      '0 items are waiting to upload.',
    );
    // In Hindi, zero takes the singular.
    expect(translate('sync.waiting', { locale: 'hi', params: { count: 0 } })).toBe(
      '0 आइटम अपलोड होने का इंतज़ार कर रहा है।',
    );
    expect(translate('sync.waiting', { locale: 'en', params: { count: 150000 } })).toBe(
      '1,50,000 items are waiting to upload.',
    );
  });

  it('fills parameters and leaves a missing one visible', () => {
    expect(
      translate('copy.finance_snapshot', {
        locale: 'en',
        params: { date: '5 Oct 2026', source: 'Tally' },
      }),
    ).toBe(
      'Figures as of 5 Oct 2026 from Tally. This is a dated snapshot, so check the date before relying on it.',
    );
    expect(translate('copy.truncated_statement', { locale: 'en' })).toContain('first {limit}');
  });
});

describe('terminology (spec 5.2)', () => {
  it('resolves the tenant word first, then the product word', () => {
    const hindi = resolveTerminology({ 'term.punch_in': { en: 'Punch in', hi: 'पंच इन' } }, 'hi');
    expect(hindi['term.punch_in']).toBe('पंच इन');
    expect(hindi['term.account']).toEqual(TERMINOLOGY_DEFAULTS.hi['term.account']);
  });
});

describe('formatting (spec 8.5)', () => {
  it('groups rupees in lakhs and keeps two decimals, exactly', () => {
    expect(formatMoney('123456', { locale: 'en' })).toBe('₹1,23,456.00');
    expect(formatMoney('10195.2', { locale: 'hi' })).toBe('₹10,195.20');
    expect(formatMoney('0.10', { locale: 'en' })).toBe('₹0.10');
    expect(formatNumber(1234567.891, { locale: 'en' }, { maximumFractionDigits: 2 })).toBe(
      '12,34,567.89',
    );
  });

  it("shows dates as they are and times in the tenant's timezone", () => {
    expect(formatDate('2026-10-05', { locale: 'en' })).toBe('5 Oct 2026');
    expect(formatDateTime('2026-10-05T20:00:00Z', { locale: 'en', timeZone: 'Asia/Kolkata' })).toBe(
      '6 Oct 2026, 1:30 am',
    );
  });
});

describe('plural forms without Intl.PluralRules (Hermes)', () => {
  it('match CLDR, as Node’s Intl.PluralRules has them, in English and Hindi', () => {
    const counts = [0, 0.5, 1, 1.5, 2, 3, 10, 11, 21, 100, 101, 1_000_000];
    for (const locale of ['en', 'hi'] as const) {
      const rules = new Intl.PluralRules(locale);
      for (const count of counts) {
        const expected = rules.select(count) === 'one' ? 'one' : 'other';
        expect(pluralForm(locale, count), `${locale} ${count}`).toBe(expected);
      }
    }
    expect(pluralForm('en', undefined)).toBe('other');
    expect(pluralForm('en', '1')).toBe('one');
  });
});
