import type { Locale } from '@thelamp/shared';

/**
 * What one viewer chooses for this browser: their language and theme. Kept in local storage,
 * which can be unavailable, so every read and write falls back quietly.
 */

export type Theme = 'light' | 'dark';

function read(key: string): string | null {
  try {
    return localStorage.getItem(`console.${key}`);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(`console.${key}`, value);
  } catch {
    // The choice lasts for this page only.
  }
}

export function savedLocale(): Locale {
  return read('locale') === 'hi' ? 'hi' : 'en';
}

export function savedTheme(): Theme {
  return read('theme') === 'dark' ? 'dark' : 'light';
}

/** Applies a language: `lang` on the root also gives Hindi its extra line height. */
export function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  write('locale', locale);
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  write('theme', theme);
}
