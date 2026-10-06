import { size as sizes } from '@kshetra/design-tokens';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from './theme';

export type IconSize = 'sm' | 'md' | 'lg' | 'xl';

const PIXELS: Record<IconSize, number> = {
  sm: sizes.iconSm,
  md: sizes.iconMd,
  lg: sizes.iconLg,
  xl: sizes.iconXl,
};

/** Lucide strokes: 2 px at 16, 1.75 px at 20 and 24, 1.5 px at 32 (README, Icons). */
const STROKE: Record<IconSize, number> = { sm: 2, md: 1.75, lg: 1.75, xl: 1.5 };

export interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  /** Defaults to the text colour; React Native has no `currentColor`. */
  color?: string;
}

/** A Lucide icon at a token size. It is decoration: the name beside it carries the meaning. */
export function Icon({ icon: Glyph, size = 'md', color }: IconProps) {
  const theme = useTheme();
  return (
    <Glyph
      size={PIXELS[size]}
      strokeWidth={STROKE[size]}
      color={color ?? theme.colors.text}
      aria-hidden
    />
  );
}
