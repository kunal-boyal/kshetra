import type { Locale } from '@thelamp/shared';

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

/** Announcements this viewer dismissed in this browser (decision D93); old ones fall away. */
export function dismissedAnnouncements(): string[] {
  try {
    const saved = JSON.parse(read('announcements.dismissed') ?? '[]') as unknown;
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function dismissAnnouncement(id: string): void {
  write('announcements.dismissed', JSON.stringify([...dismissedAnnouncements(), id].slice(-50)));
}
