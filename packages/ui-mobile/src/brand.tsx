import Svg, { Circle, G, Rect } from 'react-native-svg';

/**
 * The small Kshetra mark, drawn from `packages/design-tokens/assets/Logos/kshetra-mark-small.svg`
 * (a test keeps the two the same). Always Jamun, whatever the tenant's accent, and for sizes under
 * 96 px; larger uses take the master raster (assets/Logos/README.md).
 */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <Rect width="48" height="48" fill="#5b2b82" />
      <G fill="none" stroke="#f3edf8" strokeWidth="3">
        <Circle cx="24" cy="24" r="19.5" />
        <Circle cx="24" cy="24" r="13" />
        <Circle cx="24" cy="24" r="6.5" />
      </G>
      <Circle cx="24" cy="24" r="2.5" fill="#f3edf8" />
    </Svg>
  );
}
