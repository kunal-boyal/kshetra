import type { Locale } from '@thelamp/shared';
import { cn, Icon, Picker } from '@thelamp/ui-web';
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

/**
 * One tap to the other language (decision D104), named in itself so anyone can find their own;
 * with two languages a list has nothing to choose between.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLanguage();
  const other = LANGUAGES.find((language) => language.locale !== locale)!;
  const current = LANGUAGES.find((language) => language.locale === locale)!;
  return (
    <button
      type="button"
      className={cn('ks-btn ghost sm', className)}
      lang={other.locale}
      aria-label={t('shell.language_switch', { current: current.name, other: other.name })}
      onClick={() => setLocale(other.locale)}
    >
      <Icon icon={Languages} size="sm" />
      {other.name}
    </button>
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
