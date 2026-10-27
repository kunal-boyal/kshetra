import type { Locale } from '@thelamp/shared';
import { getLocales } from 'expo-localization';
import { storage } from './storage';

/**
 * What the person chooses on this phone: their language and display. The display is kept per
 * phone, not per person, because it depends on where the phone is used (tenant-theming.md).
 */

export type Display = 'system' | 'light' | 'dark' | 'outdoor';

function read(key: string): string | null {
  try {
    return storage.read(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    storage.write(key, value);
  } catch {
    // The choice lasts until the app closes.
  }
}

/** The saved language, or the phone's when it is Hindi, or English. */
export function savedLocale(): Locale {
  const saved = read('locale');
  if (saved === 'hi' || saved === 'en') return saved;
  return getLocales()[0]?.languageCode === 'hi' ? 'hi' : 'en';
}

export function saveLocale(locale: Locale): void {
  write('locale', locale);
}

export function savedDisplay(): Display {
  const saved = read('display');
  return saved === 'light' || saved === 'dark' || saved === 'outdoor' ? saved : 'system';
}

export function saveDisplay(display: Display): void {
  write('display', display);
}

/** The tenant's brand colour, kept so the next launch is branded before the config loads. */
export function savedBrand(): string | null {
  const saved = read('brand');
  return saved && /^#[0-9a-f]{6}$/i.test(saved) ? saved : null;
}

export function saveBrand(hex: string | null): void {
  if (hex) write('brand', hex);
  else {
    try {
      storage.remove('brand');
    } catch {
      // Nothing was kept.
    }
  }
}
