import { ACCENT_THEMES, type AccentTheme, deriveAccent } from '@thelamp/shared';

/**
 * The tenant's accent on the web (spec 5.1, tenant-theming.md, decision D64): the six accent
 * variables derived from its brand colour, written as one style element over the tokens' own, in
 * every theme. The colour is kept for the next page load, so the first paint is already branded.
 */

const STYLE_ID = 'tenant-accent';
const KEY = 'brand';

function remember(hex: string | null): void {
  try {
    if (hex) localStorage.setItem(KEY, hex);
    else localStorage.removeItem(KEY);
  } catch {
    // The accent still applies for this page.
  }
}

/** The CSS that sets one theme's accent over the tokens' defaults. */
export function accentCss(hex: string): string {
  const { palettes } = deriveAccent(hex);
  const block = (theme: AccentTheme) =>
    Object.entries(palettes[theme])
      .map(([name, value]) => `--${name}:${value};`)
      .join('');
  const selector = (theme: AccentTheme) =>
    theme === 'light'
      ? ':root:not([data-theme]),:root[data-theme="light"]'
      : `:root[data-theme="${theme}"]`;
  return ACCENT_THEMES.map((theme) => `${selector(theme)}{${block(theme)}}`).join('');
}

/** Applies a tenant's brand colour, or the product's own accent for null. */
export function applyBrand(hex: string | null): void {
  remember(hex);
  let style = document.getElementById(STYLE_ID);
  if (!hex) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.append(style);
  }
  style.textContent = accentCss(hex);
}

/** Applies the colour kept from last time, before the config arrives. */
export function applySavedBrand(): void {
  try {
    const hex = localStorage.getItem(KEY);
    if (hex && /^#[0-9a-f]{6}$/i.test(hex)) applyBrand(hex);
  } catch {
    // Nothing was kept.
  }
}
