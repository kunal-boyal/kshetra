import { type MessageKey, type ResolvedTerminology, translate } from '@kshetra/i18n';
import { ApiError, NetworkError } from '@kshetra/api-client';
import type { Locale } from '@kshetra/shared';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { applyLocale, savedLocale } from './preferences';

type Params = Readonly<Record<string, string | number>>;

interface Language {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** The tenant's words for the current language, from the config bundle once signed in. */
  setTerms: (terms: Partial<Record<Locale, ResolvedTerminology>> | undefined) => void;
  t: (key: MessageKey, params?: Params) => string;
}

const LanguageContext = createContext<Language | null>(null);

/** Every string on screen goes through here, in English or Hindi (spec 8.6). */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(savedLocale);
  const [terms, setTerms] = useState<Partial<Record<Locale, ResolvedTerminology>>>();
  const setLocale = useCallback((next: Locale) => {
    applyLocale(next);
    setLocaleState(next);
  }, []);
  const t = useCallback(
    (key: MessageKey, params?: Params) =>
      translate(key, {
        locale,
        ...(params ? { params } : {}),
        ...(terms?.[locale] ? { terms: terms[locale] } : {}),
      }),
    [locale, terms],
  );
  const value = useMemo(() => ({ locale, setLocale, setTerms, t }), [locale, setLocale, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): Language {
  const language = useContext(LanguageContext);
  if (!language) throw new Error('useLanguage needs a LanguageProvider.');
  return language;
}

/** What went wrong, in the reader's language (spec 8.4: every error code has its message). */
export function errorMessage(error: unknown, t: Language['t']): string {
  if (error instanceof NetworkError) return t('common.offline');
  if (error instanceof ApiError) return t(`error.${error.code}`);
  return t('error.INTERNAL');
}
