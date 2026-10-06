import {
  NotoSans_400Regular,
  NotoSans_500Medium,
  NotoSans_600SemiBold,
  NotoSans_700Bold,
} from '@expo-google-fonts/noto-sans';
import {
  NotoSansDevanagari_400Regular,
  NotoSansDevanagari_500Medium,
  NotoSansDevanagari_600SemiBold,
  NotoSansDevanagari_700Bold,
} from '@expo-google-fonts/noto-sans-devanagari';
import type { FontFaces } from '@kshetra/ui-mobile';
import { useFonts } from 'expo-font';

const FACES: FontFaces = {
  latin: {
    400: 'NotoSans_400Regular',
    500: 'NotoSans_500Medium',
    600: 'NotoSans_600SemiBold',
    700: 'NotoSans_700Bold',
  },
  // Noto Sans Devanagari carries Latin too, so Hindi screens use it for everything.
  devanagari: {
    400: 'NotoSansDevanagari_400Regular',
    500: 'NotoSansDevanagari_500Medium',
    600: 'NotoSansDevanagari_600SemiBold',
    700: 'NotoSansDevanagari_700Bold',
  },
};

/**
 * iOS (and the development web target) load Noto Sans and Noto Sans Devanagari, the design
 * system's family (D18). Android uses the phone's own fonts; see fonts.android.ts.
 */
export function useAppFonts(): { ready: boolean; faces?: FontFaces } {
  const [loaded, failed] = useFonts({
    NotoSans_400Regular,
    NotoSans_500Medium,
    NotoSans_600SemiBold,
    NotoSans_700Bold,
    NotoSansDevanagari_400Regular,
    NotoSansDevanagari_500Medium,
    NotoSansDevanagari_600SemiBold,
    NotoSansDevanagari_700Bold,
  });
  // Fonts that fail to load leave the system's, rather than a blank screen.
  if (failed) return { ready: true };
  return loaded ? { ready: true, faces: FACES } : { ready: false };
}
