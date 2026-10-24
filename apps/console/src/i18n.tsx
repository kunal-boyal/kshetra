import { ApiError, NetworkError } from '@thelamp/api-client';
import { type MessageKey, translate } from '@thelamp/i18n';
import type { Locale } from '@thelamp/shared';
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
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): Language {
  const language = useContext(LanguageContext);
  if (!language) throw new Error('useLanguage needs a LanguageProvider.');
  return language;
}

/** What went wrong, in the reader's language (spec 8.4). */
export function errorMessage(error: unknown, t: Language['t']): string {
  if (error instanceof NetworkError) return t('common.offline');
  if (error instanceof ApiError) return t(`error.${error.code}`);
  return t('error.INTERNAL');
}

/** Field errors from the API's details, by path (spec 11.1). */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(error.details.map(({ path, issue }) => [path, issue]));
}
