import { contrastRatio } from './colour';

/**
 * A tenant's accent palette, derived from its one brand colour (spec 5.1, decision D64), as
 * `packages/design-tokens/tenant-theming.md` sets out: in OKLCH, so lightness steps look even
 * across hues, then checked in every theme and nudged in lightness where a pair falls short.
 */

export const ACCENT_THEMES = ['light', 'dark', 'outdoor'] as const;
export type AccentTheme = (typeof ACCENT_THEMES)[number];

/** The six tenant tokens, by their CSS names without the leading dashes. */
export interface AccentPalette {
  accent: string;
  'accent-hover': string;
  'accent-subtle': string;
  'accent-soft': string;
  'accent-subtle-fg': string;
  'on-accent': string;
}

/** The surfaces the checks are made against, from the tokens. */
const SURFACE: Record<AccentTheme, string> = {
  light: '#ffffff',
  dark: '#1b1a18',
  outdoor: '#ffffff',
};

interface Lch {
  l: number;
  c: number;
  h: number;
}

const toLinear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const fromLinear = (channel: number) =>
  channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;

/** A hex colour in OKLCH (Björn Ottosson's OKLab, in polar form). */
export function toOklch(hex: string): Lch {
  const [r, g, b] = [1, 3, 5].map((start) =>
    toLinear(Number.parseInt(hex.slice(start, start + 2), 16) / 255),
  ) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/** The linear sRGB channels of an OKLCH colour, possibly outside 0–1. */
function linearRgb({ l: L, c, h }: Lch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** An OKLCH colour as hex, its chroma reduced until it fits sRGB, so the hue holds. */
export function fromOklch(colour: Lch): string {
  const l = Math.min(1, Math.max(0, colour.l));
  let c = Math.max(0, colour.c);
  let rgb = linearRgb({ l, c, h: colour.h });
  while (c > 0 && rgb.some((channel) => channel < -1e-4 || channel > 1 + 1e-4)) {
    c = Math.max(0, c - 0.002);
    rgb = linearRgb({ l, c, h: colour.h });
  }
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, channel))))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** The darkest shade of a colour, same hue, that white text on reaches 4.5:1; the colour if it does. */
export function nearestPassingShade(hex: string, floor = 4.5): string {
  const base = toOklch(hex);
  let colour = hex.toLowerCase();
  for (let l = base.l; contrastRatio(colour, '#ffffff') < floor && l > 0; l -= 0.005) {
    colour = fromOklch({ ...base, l });
  }
  return colour;
}

/** Moves `l` by `step` until `passes` holds, at most to the end of the range. */
function nudge(lch: Lch, step: number, passes: (hex: string) => boolean): Lch {
  let current = lch;
  for (let i = 0; i < 200 && !passes(fromOklch(current)); i += 1) {
    current = { ...current, l: Math.min(1, Math.max(0, current.l + step)) };
  }
  return current;
}

/** One theme's palette, and the pairs whose lightness had to move to pass. */
function themePalette(
  brand: string,
  theme: AccentTheme,
): {
  palette: AccentPalette;
  adjusted: string[];
} {
  const b = toOklch(brand);
  const floor = theme === 'outdoor' ? 7 : 4.5;
  const surface = SURFACE[theme];
  const adjusted: string[] = [];
  const at = (l: number, c: number) => ({ l, c, h: b.h });

  let accent: Lch;
  let onAccent: Lch | 'white';
  if (theme === 'dark') {
    accent = at(0.78, Math.min(b.c, 0.12));
    onAccent = at(0.21, b.c * 0.4);
  } else {
    accent = { ...b };
    onAccent = 'white';
    if (theme === 'outdoor') {
      accent = nudge(accent, -0.005, (hex) => contrastRatio(hex, '#ffffff') >= 7);
    }
  }
  const hoverStep = theme === 'dark' ? 0.06 : -0.06;
  const subtle = theme === 'dark' ? at(0.27, b.c * 0.35) : at(0.96, b.c * 0.15);
  const soft =
    theme === 'dark'
      ? at(0.34, b.c * 0.41)
      : theme === 'outdoor'
        ? at(0.93, b.c * 0.25)
        : at(0.905, b.c * 0.32);
  let subtleFg = theme === 'dark' ? at(0.86, b.c * 0.6) : at(theme === 'outdoor' ? 0.3 : 0.35, b.c);

  const on = onAccent === 'white' ? '#ffffff' : fromOklch(onAccent);
  // Checks of tenant-theming.md, each nudged away from its partner until it passes.
  const away = theme === 'dark' ? 0.005 : -0.005;
  const accentChecked = nudge(
    accent,
    away,
    (hex) => contrastRatio(on, hex) >= floor && contrastRatio(hex, surface) >= 3,
  );
  if (accentChecked.l !== accent.l) adjusted.push('accent');
  accent = accentChecked;
  let hover = { ...accent, l: accent.l + hoverStep };
  const hoverChecked = nudge(hover, away, (hex) => contrastRatio(on, hex) >= floor);
  if (hoverChecked.l !== hover.l) adjusted.push('accent-hover');
  hover = hoverChecked;
  const fgChecked = nudge(
    subtleFg,
    theme === 'dark' ? 0.005 : -0.005,
    (hex) =>
      contrastRatio(hex, fromOklch(subtle)) >= floor &&
      contrastRatio(hex, fromOklch(soft)) >= floor,
  );
  if (fgChecked.l !== subtleFg.l) adjusted.push('accent-subtle-fg');
  subtleFg = fgChecked;

  return {
    palette: {
      accent: fromOklch(accent),
      'accent-hover': fromOklch(hover),
      'accent-subtle': fromOklch(subtle),
      'accent-soft': fromOklch(soft),
      'accent-subtle-fg': fromOklch(subtleFg),
      'on-accent': on,
    },
    adjusted,
  };
}

/**
 * The accent palette of every theme from one brand colour. `adjusted` names the tokens whose
 * lightness moved to pass their checks, for the branding change's audit entry.
 */
export function deriveAccent(brand: string): {
  palettes: Record<AccentTheme, AccentPalette>;
  adjusted: Record<AccentTheme, string[]>;
} {
  const results = Object.fromEntries(
    ACCENT_THEMES.map((theme) => [theme, themePalette(brand.toLowerCase(), theme)]),
  ) as Record<AccentTheme, ReturnType<typeof themePalette>>;
  return {
    palettes: Object.fromEntries(
      ACCENT_THEMES.map((theme) => [theme, results[theme].palette]),
    ) as Record<AccentTheme, AccentPalette>,
    adjusted: Object.fromEntries(
      ACCENT_THEMES.map((theme) => [theme, results[theme].adjusted]),
    ) as Record<AccentTheme, string[]>,
  };
}

/**
 * Whether a brand hue sits within 20° of a status hue (tenant-theming.md's collision guard): the
 * accent then never stands alone as an indicator.
 */
export function collidesWithStatus(brand: string): boolean {
  const { h, c } = toOklch(brand);
  if (c < 0.03) return false;
  return [145, 80, 55, 255, 25].some((status) => {
    const distance = Math.abs(h - status) % 360;
    return Math.min(distance, 360 - distance) <= 20;
  });
}
