import type { FontFaces } from '@thelamp/ui-mobile';

/**
 * Android uses the phone's own fonts, so the app downloads none (platforms.md, Mobile): Noto Sans
 * Devanagari for Hindi, which Android ships, and the phone's Latin face, Roboto on most phones.
 * Decision D36 weighs bundling Noto Sans instead.
 */
export function useAppFonts(): { ready: boolean; faces?: FontFaces } {
  return { ready: true };
}
