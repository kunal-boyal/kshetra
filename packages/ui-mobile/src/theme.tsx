import { colors, shadows, typeStyles } from '@thelamp/design-tokens';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { Platform, type TextStyle } from 'react-native';

export type ThemeName = 'light' | 'dark' | 'outdoor';
export type Colors = Record<keyof (typeof colors)['light'], string>;
export type Shadows = Record<keyof (typeof shadows)['light'], string>;
export type TypeStyleName = keyof typeof typeStyles;

/** Which faces the text needs: Latin, or Devanagari for Hindi (and Latin inside it). */
export type Script = 'latin' | 'devanagari';
export type Weight = 400 | 500 | 600 | 700;

/**
 * The loaded font faces by script and weight, where the app loads its own (platforms.md, Mobile).
 * A script left out uses the phone's system font at the style's weight.
 */
export type FontFaces = Partial<Record<Script, Record<Weight, string>>>;

export interface Theme {
  name: ThemeName;
  colors: Colors;
  shadows: Shadows;
  script: Script;
  /** The text style for a type style in this theme's script, optionally at another weight. */
  text: (style: TypeStyleName, weight?: Weight) => TextStyle;
}

/** Indic scripts get 4 px more line height and never go below 13 px (README, Type). */
const LEAD: Record<Script, number> = { latin: 0, devanagari: 4 };
const MIN_SIZE: Record<Script, number> = { latin: 0, devanagari: 13 };
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

function textStyle(
  name: TypeStyleName,
  script: Script,
  faces: FontFaces | undefined,
  weightOverride: Weight | undefined,
): TextStyle {
  const style = typeStyles[name] as {
    family: string;
    fontSize: number;
    lineHeight: number;
    fontWeight: Weight;
    letterSpacing?: string;
    tabularNumbers?: boolean;
  };
  const weight = weightOverride ?? style.fontWeight;
  const fontSize = Math.max(style.fontSize, MIN_SIZE[script]);
  const face = style.family === 'mono' ? MONO : faces?.[script]?.[weight];
  return {
    fontSize,
    lineHeight: style.lineHeight + LEAD[script] + (fontSize - style.fontSize),
    // A loaded face is one weight already; the system font takes the weight instead.
    ...(face ? { fontFamily: face } : { fontWeight: String(weight) as TextStyle['fontWeight'] }),
    ...(style.letterSpacing
      ? { letterSpacing: Number.parseFloat(style.letterSpacing) * fontSize }
      : {}),
    ...(style.tabularNumbers ? { fontVariant: ['tabular-nums'] } : {}),
  };
}

/** The six tenant tokens a brand colour sets (tenant-theming.md); the rest stay the product's. */
export type AccentColors = Pick<
  Colors,
  'accent' | 'accentHover' | 'accentSubtle' | 'accentSoft' | 'accentSubtleFg' | 'onAccent'
>;

export function createTheme(
  name: ThemeName,
  script: Script,
  faces?: FontFaces,
  accent?: AccentColors,
): Theme {
  const cache = new Map<string, TextStyle>();
  return {
    name,
    colors: accent ? { ...colors[name], ...accent, focusRing: accent.accent } : colors[name],
    shadows: shadows[name],
    script,
    text: (style, weight) => {
      const key = `${style}:${weight ?? ''}`;
      let found = cache.get(key);
      if (!found) {
        found = textStyle(style, script, faces, weight);
        cache.set(key, found);
      }
      return found;
    },
  };
}

const ThemeContext = createContext<Theme>(createTheme('light', 'latin'));

/**
 * Light, Dark or Outdoor, in the script of the reader's language. The app chooses the theme: the
 * person's choice, or the phone's when they chose "Same as phone". Outdoor is never automatic.
 */
export function ThemeProvider({
  name,
  script,
  faces,
  accent,
  children,
}: {
  name: ThemeName;
  script: Script;
  faces?: FontFaces;
  /** The tenant's accent in this theme, derived from its brand colour; none keeps the product's. */
  accent?: AccentColors;
  children: ReactNode;
}) {
  const theme = useMemo(
    () => createTheme(name, script, faces, accent),
    [name, script, faces, accent],
  );
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
