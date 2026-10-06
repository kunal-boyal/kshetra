import type { Locale } from '@kshetra/shared';
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

export interface TenantChoice {
  id: string;
  name: string;
}

/** The tenants offered after the last code, for switching. They belong to whoever signed in. */
export function savedTenants(): TenantChoice[] {
  try {
    const value: unknown = JSON.parse(read('tenants') ?? '[]');
    return Array.isArray(value) ? (value as TenantChoice[]) : [];
  } catch {
    return [];
  }
}

export function saveTenants(tenants: TenantChoice[]): void {
  write('tenants', JSON.stringify(tenants));
}

/** Forgets the tenants when the session ends, so the next person on this phone never sees them. */
export async function forgetTenants(): Promise<void> {
  try {
    await storage.remove('tenants');
  } catch {
    // Nothing was kept.
  }
}
