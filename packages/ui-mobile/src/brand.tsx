import Svg, { Path, Rect } from 'react-native-svg';

/**
 * The small product mark, drawn from `packages/design-tokens/assets/Logos/mark-small.svg`
 * (a test keeps the two the same): a map pin holding a flame (decision D72). Always Forest,
 * whatever the tenant's accent, and for sizes under 96 px; larger uses take the master raster
 * (assets/Logos/README.md).
 */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <Rect width="48" height="48" fill="#1e5a3a" />
      <Path
        d="M24 7a12.5 12.5 0 0 1 12.5 12.5c0 9.4-12.5 21.5-12.5 21.5S11.5 28.9 11.5 19.5A12.5 12.5 0 0 1 24 7z"
        fill="#f3f5f1"
      />
      <Path
        d="M24.6 10.6C26.3 13.9 29.2 16.4 29.2 20.6A5.2 5.2 0 0 1 18.8 20.6C18.8 17.9 20.4 15.9 22.2 14.3C22 16 22.6 17.5 23.6 18.3C23.3 15.7 23.7 13 24.6 10.6Z"
        fill="#e3a72f"
      />
    </Svg>
  );
}
