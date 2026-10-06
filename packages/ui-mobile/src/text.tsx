import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';
import { type Colors, type TypeStyleName, useTheme, type Weight } from './theme';

export type Tone = 'default' | 'muted' | 'subtle' | 'accent' | 'danger' | 'inverse';

const TONE: Record<Tone, keyof Colors> = {
  default: 'text',
  muted: 'textMuted',
  subtle: 'textSubtle',
  accent: 'accentSubtleFg',
  danger: 'dangerFg',
  inverse: 'textInverse',
};

export interface TextProps extends NativeTextProps {
  /** A type style from the tokens. Body text on a phone is `bodyLg` (comfortable density). */
  variant?: TypeStyleName;
  tone?: Tone;
  /** Another weight than the style's, such as 500 for an error under a field. */
  weight?: Weight;
}

/** Text in a type style and a tone. React Native passes no colour down, so every text sets one. */
export function Text({ variant = 'bodyLg', tone = 'default', weight, style, ...rest }: TextProps) {
  const theme = useTheme();
  return (
    <NativeText
      style={[theme.text(variant, weight), { color: theme.colors[TONE[tone]] }, style]}
      {...rest}
    />
  );
}
