import { colors } from '@kshetra/design-tokens';
import { deriveAccent } from '@kshetra/shared';
import { type AccentColors, type ThemeName, ThemeProvider } from '@kshetra/ui-mobile';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { useApp } from './app-state';
import { useConfig } from './data';
import { useAppFonts } from './fonts';
import { useLanguage } from './i18n';
import { type Display, saveBrand, savedBrand, saveDisplay, savedDisplay } from './preferences';

interface DisplayChoice {
  display: Display;
  setDisplay: (display: Display) => void;
  /** The tenant's brand colour, from its config, or null for the product's own accent. */
  setBrand: (hex: string | null) => void;
}

/** A derived palette in the mobile theme's names (tenant-theming.md). */
function accentFor(hex: string, theme: ThemeName): AccentColors {
  const palette = deriveAccent(hex).palettes[theme];
  return {
    accent: palette.accent,
    accentHover: palette['accent-hover'],
    accentSubtle: palette['accent-subtle'],
    accentSoft: palette['accent-soft'],
    accentSubtleFg: palette['accent-subtle-fg'],
    onAccent: palette['on-accent'],
  };
}

const DisplayContext = createContext<DisplayChoice | null>(null);

/**
 * The theme and type for the whole app: the person's display choice, or the phone's light or dark
 * when they chose "Same as phone". Outdoor is only ever chosen, never switched on by itself (D19).
 * Hindi takes the Devanagari faces and the taller line heights. The tenant's brand colour gives the
 * accent while someone is signed in (decision D64).
 */
export function Look({ children }: { children: ReactNode }) {
  const { locale } = useLanguage();
  const scheme = useColorScheme();
  const fonts = useAppFonts();
  const { session } = useApp();
  const [display, setDisplayState] = useState<Display>(savedDisplay);
  // Kept from last time, so an offline cold start is already branded.
  const [brand, setBrandState] = useState<string | null>(savedBrand);
  const name: ThemeName = display === 'system' ? (scheme === 'dark' ? 'dark' : 'light') : display;
  // The tenant's accent while someone is signed in; sign-in shows the product's own.
  const accent = useMemo(
    () => (brand && session ? accentFor(brand, name) : undefined),
    [brand, session, name],
  );

  useEffect(() => {
    // The window behind the app, seen during transitions and under the keyboard.
    void SystemUI.setBackgroundColorAsync(colors[name].bg);
  }, [name]);

  const choice = useMemo(
    () => ({
      display,
      setDisplay: (next: Display) => {
        saveDisplay(next);
        setDisplayState(next);
      },
      setBrand: (next: string | null) => {
        saveBrand(next);
        setBrandState(next);
      },
    }),
    [display],
  );

  // The splash screen stays up until the fonts are in.
  if (!fonts.ready) return null;
  return (
    <DisplayContext.Provider value={choice}>
      <ThemeProvider
        name={name}
        script={locale === 'hi' ? 'devanagari' : 'latin'}
        {...(fonts.faces ? { faces: fonts.faces } : {})}
        {...(accent ? { accent } : {})}
      >
        <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
        {children}
      </ThemeProvider>
    </DisplayContext.Provider>
  );
}

export function useDisplay(): DisplayChoice {
  const choice = useContext(DisplayContext);
  if (!choice) throw new Error('useDisplay needs the Look provider.');
  return choice;
}

/** Follows the tenant's brand colour in its config, for the signed-in app. */
export function useTenantBrand(): void {
  const config = useConfig();
  const { setBrand } = useDisplay();
  const brand = config.data?.bundle.settings.brandColour;
  useEffect(() => {
    if (brand !== undefined) setBrand(brand);
  }, [brand, setBrand]);
}
