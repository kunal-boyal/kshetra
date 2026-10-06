import { colors } from '@kshetra/design-tokens';
import { type ThemeName, ThemeProvider } from '@kshetra/ui-mobile';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { useAppFonts } from './fonts';
import { useLanguage } from './i18n';
import { type Display, saveDisplay, savedDisplay } from './preferences';

interface DisplayChoice {
  display: Display;
  setDisplay: (display: Display) => void;
}

const DisplayContext = createContext<DisplayChoice | null>(null);

/**
 * The theme and type for the whole app: the person's display choice, or the phone's light or dark
 * when they chose "Same as phone". Outdoor is only ever chosen, never switched on by itself (D19).
 * Hindi takes the Devanagari faces and the taller line heights.
 */
export function Look({ children }: { children: ReactNode }) {
  const { locale } = useLanguage();
  const scheme = useColorScheme();
  const fonts = useAppFonts();
  const [display, setDisplayState] = useState<Display>(savedDisplay);
  const name: ThemeName = display === 'system' ? (scheme === 'dark' ? 'dark' : 'light') : display;

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
