import type { Locale } from '@thelamp/shared';
import { useState } from 'react';
import { useLanguage } from '../i18n';
import { applyTheme, savedTheme, type Theme } from '../preferences';

const LANGUAGES: { locale: Locale; name: string }[] = [
  { locale: 'en', name: 'English' },
  { locale: 'hi', name: 'हिन्दी' },
];

/** Each language named in itself, so anyone can find their own. */
export function LanguagePicker() {
  const { locale, setLocale, t } = useLanguage();
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">{t('shell.language')}</span>
      <select
        className="ks-input h-[var(--control-sm)] w-auto py-0"
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        {LANGUAGES.map((language) => (
          <option key={language.locale} value={language.locale} lang={language.locale}>
            {language.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Light, Dark, or High contrast, which is the Outdoor theme (packages/design-tokens/tenant-theming.md). */
export function ThemePicker() {
  const { t } = useLanguage();
  const [theme, setTheme] = useState<Theme>(savedTheme);
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">{t('shell.theme')}</span>
      <select
        className="ks-input h-[var(--control-sm)] w-auto py-0"
        value={theme}
        onChange={(event) => {
          const next = event.target.value as Theme;
          applyTheme(next);
          setTheme(next);
        }}
      >
        <option value="light">{t('shell.theme_light')}</option>
        <option value="dark">{t('shell.theme_dark')}</option>
        <option value="outdoor">{t('shell.theme_outdoor')}</option>
      </select>
    </label>
  );
}
