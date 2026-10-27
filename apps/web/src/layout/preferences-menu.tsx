import type { Locale } from '@thelamp/shared';
import { Picker } from '@thelamp/ui-web';
import { Contrast, Languages, type LucideIcon, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { useLanguage } from '../i18n';
import { applyTheme, savedTheme, type Theme } from '../preferences';

const LANGUAGES: { locale: Locale; name: string }[] = [
  { locale: 'en', name: 'English' },
  { locale: 'hi', name: 'हिन्दी' },
];

/** The theme picker shows the theme it is in. */
const THEME_ICONS: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, outdoor: Contrast };

/** Each language named in itself, so anyone can find their own. */
export function LanguagePicker() {
  const { locale, setLocale, t } = useLanguage();
  return (
    <Picker
      label={t('shell.language')}
      icon={Languages}
      value={locale}
      onChange={(event) => setLocale(event.target.value as Locale)}
      options={LANGUAGES.map((language) => ({
        value: language.locale,
        label: language.name,
        lang: language.locale,
      }))}
    />
  );
}

/** Light, Dark, or High contrast, which is the Outdoor theme (packages/design-tokens/tenant-theming.md). */
export function ThemePicker() {
  const { t } = useLanguage();
  const [theme, setTheme] = useState<Theme>(savedTheme);
  return (
    <Picker
      label={t('shell.theme')}
      icon={THEME_ICONS[theme]}
      value={theme}
      onChange={(event) => {
        const next = event.target.value as Theme;
        applyTheme(next);
        setTheme(next);
      }}
      options={[
        { value: 'light', label: t('shell.theme_light') },
        { value: 'dark', label: t('shell.theme_dark') },
        { value: 'outdoor', label: t('shell.theme_outdoor') },
      ]}
    />
  );
}
