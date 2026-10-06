import type { Locale } from '@kshetra/shared';

/**
 * What one viewer chooses for this browser: their language and theme. Kept in local storage,
 * which can be unavailable, so every read and write falls back quietly.
 */

export type Theme = 'light' | 'dark' | 'outdoor';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice lasts for this page only.
  }
}

export function savedLocale(): Locale {
  return read('locale') === 'hi' ? 'hi' : 'en';
}

export function savedTheme(): Theme {
  const theme = read('theme');
  return theme === 'dark' || theme === 'outdoor' ? theme : 'light';
}

/** Applies a language: `lang` on the root also gives Hindi its extra line height. */
export function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  write('locale', locale);
}

/** Applies a theme. High contrast is the Outdoor theme, chosen, never switched on by itself. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  write('theme', theme);
}

/**
 * The tenants offered after the last code, so the menu can switch between them. Not secret, but
 * they belong to whoever signed in, so the session's end forgets them.
 */
export function savedTenants(): { id: string; name: string }[] {
  try {
    const value: unknown = JSON.parse(read('tenants') ?? '[]');
    return Array.isArray(value) ? (value as { id: string; name: string }[]) : [];
  } catch {
    return [];
  }
}

export function saveTenants(tenants: { id: string; name: string }[]): void {
  write('tenants', JSON.stringify(tenants));
}

/** Forgets the tenants, so the next person on a shared computer never sees them. */
export function forgetTenants(): void {
  try {
    localStorage.removeItem('tenants');
  } catch {
    // Nothing was kept.
  }
}
