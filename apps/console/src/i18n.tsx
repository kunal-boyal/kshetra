import { ApiError, NetworkError } from '@thelamp/api-client';
import { formatNumber, type MessageKey, translate } from '@thelamp/i18n';
import { type PagerText, PagerTextProvider } from '@thelamp/ui-web';
import type { ErrorCode, Locale } from '@thelamp/shared';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { applyLocale, savedLocale } from './preferences';

type Params = Readonly<Record<string, string | number>>;

interface Language {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: Params) => string;
}

const LanguageContext = createContext<Language | null>(null);

/** Every string on screen goes through here, in English or Hindi (spec 8.6). */
export function LanguageProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? savedLocale());
  const setLocale = useCallback((next: Locale) => {
    applyLocale(next);
    setLocaleState(next);
  }, []);
  const t = useCallback(
    (key: MessageKey, params?: Params) => translate(key, { locale, ...(params ? { params } : {}) }),
    [locale],
  );
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  // Every table's pager speaks the reader's language (decision D104).
  const pager = useMemo<PagerText>(
    () => ({
      previous: t('pager.previous'),
      next: t('pager.next'),
      label: t('pager.label'),
      showing: (from, to) =>
        t('pager.showing', {
          from: formatNumber(from, { locale }),
          to: formatNumber(to, { locale }),
        }),
    }),
    [t, locale],
  );
  return (
    <LanguageContext.Provider value={value}>
      <PagerTextProvider value={pager}>{children}</PagerTextProvider>
    </LanguageContext.Provider>
  );
}

export function useLanguage(): Language {
  const language = useContext(LanguageContext);
  if (!language) throw new Error('useLanguage needs a LanguageProvider.');
  return language;
}

/**
 * Refusals whose general text can't say why, where the server's own message does: "Add the
 * tenant's billing details first.", "Suspend the tenant before terminating it."
 */
const REASONED: ReadonlySet<ErrorCode> = new Set([
  'CONFLICT',
  'FORBIDDEN',
  'NOT_FOUND',
  'IDEMPOTENCY_CONFLICT',
  'VALIDATION',
]);

/**
 * What went wrong, in the reader's language (spec 8.4). A refusal the server gave its own reason
 * for shows that reason. The API's messages are English (decision D42's open item), so a Hindi
 * reader sees a Hindi line saying it couldn't be done, then the reason. A form's field problems
 * show by their fields, so a validation refusal with them keeps the general text.
 */
export function errorMessage(error: unknown, t: Language['t']): string {
  if (error instanceof NetworkError) return t('common.offline');
  if (error instanceof ApiError) {
    const reason = error.message.trim();
    const own =
      REASONED.has(error.code) &&
      !(error.code === 'VALIDATION' && error.details.length > 0) &&
      reason !== '' &&
      reason !== translate(`error.${error.code}`, { locale: 'en' });
    return own ? t('console.error_reason', { reason }) : t(`error.${error.code}`);
  }
  return t('error.INTERNAL');
}

/** Field errors from the API's details, by path (spec 11.1). */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(error.details.map(({ path, issue }) => [path, issue]));
}
