import {
  Mukta_400Regular,
  Mukta_500Medium,
  Mukta_600SemiBold,
  Mukta_700Bold,
} from '@expo-google-fonts/mukta';
import type { FontFaces } from '@thelamp/ui-mobile';
import { useFonts } from 'expo-font';

// Mukta is drawn for Latin and Devanagari alike, so both scripts use the same faces.
const MUKTA = {
  400: 'Mukta_400Regular',
  500: 'Mukta_500Medium',
  600: 'Mukta_600SemiBold',
  700: 'Mukta_700Bold',
} as const;

const FACES: FontFaces = { latin: MUKTA, devanagari: MUKTA };

/**
 * Every platform loads Mukta, the design system's face (decision D72): the brand's type on the
 * phone as on the web, bundled with the app rather than taken from the phone.
 */
export function useAppFonts(): { ready: boolean; faces?: FontFaces } {
  const [loaded, failed] = useFonts({
    Mukta_400Regular,
    Mukta_500Medium,
    Mukta_600SemiBold,
    Mukta_700Bold,
  });
  // Fonts that fail to load leave the system's, rather than a blank screen.
  if (failed) return { ready: true };
  return loaded ? { ready: true, faces: FACES } : { ready: false };
}
