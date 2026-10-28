import { opacity, radius, size, spacing } from '@thelamp/design-tokens';
import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, type PressableProps, StyleSheet, View } from 'react-native';
import { Icon } from './icon';
import { Text } from './text';
import { type Colors, useTheme } from './theme';

export type ButtonVariant = 'primary' | 'tonal' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style' | 'disabled'> {
  /** A verb-first label, such as "Send code". */
  label: string;
  /** `primary` marks the one thing a screen exists to do; at most one per screen. */
  variant?: ButtonVariant;
  /** A leading Lucide icon; every mobile primary and tonal button has one (components/Button). */
  icon?: LucideIcon;
  /** Working: the button stays put but can't be pressed again. */
  busy?: boolean;
  disabled?: boolean;
  /** Full width. */
  block?: boolean;
  /** `sm` is 40 px, for buttons beside others in a row or a card; screens' own actions stay 48. */
  size?: 'md' | 'sm';
}

interface Look {
  fill: keyof Colors | 'transparent';
  pressed: keyof Colors;
  ink: keyof Colors;
  edge?: keyof Colors;
}

const LOOKS: Record<ButtonVariant, Look> = {
  primary: { fill: 'accent', pressed: 'accentHover', ink: 'onAccent' },
  tonal: { fill: 'accentSubtle', pressed: 'accentSoft', ink: 'accentSubtleFg' },
  secondary: { fill: 'surface', pressed: 'surfaceSunken', ink: 'text', edge: 'borderStrong' },
  ghost: { fill: 'transparent', pressed: 'accentSubtle', ink: 'accentSubtleFg' },
  danger: { fill: 'dangerSolid', pressed: 'dangerSolid', ink: 'onDanger' },
};

/**
 * A pill-shaped button, 48 px tall as every mobile button is, that scales to 97% when pressed
 * (components/Button). In Outdoor, glare washes out tints, so tonal becomes an outline and ghost
 * is underlined.
 */
export function Button({
  label,
  variant = 'secondary',
  icon,
  busy = false,
  disabled = false,
  block = false,
  size: scale = 'md',
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const outdoor = theme.name === 'outdoor';
  const look = LOOKS[variant];
  const colour = (key: keyof Colors | 'transparent') =>
    key === 'transparent' ? 'transparent' : theme.colors[key];
  const outline =
    outdoor && variant === 'tonal'
      ? { borderWidth: 2, borderColor: theme.colors.accent }
      : look.edge
        ? { borderWidth: outdoor ? 2 : 1, borderColor: theme.colors[look.edge] }
        : null;
  const inactive = disabled || busy;
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={inactive}
      aria-busy={busy}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        scale === 'sm' && styles.small,
        block && styles.block,
        {
          backgroundColor:
            outdoor && variant === 'tonal'
              ? theme.colors.surface
              : pressed
                ? colour(look.pressed)
                : colour(look.fill),
        },
        outline,
        pressed && !inactive && styles.pressed,
        disabled && styles.disabled,
      ]}
      {...rest}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.colors[look.ink]} />
      ) : icon ? (
        <Icon icon={icon} color={theme.colors[look.ink]} />
      ) : null}
      <View>
        <Text
          variant={scale === 'sm' ? 'labelMd' : 'labelLg'}
          numberOfLines={1}
          style={[
            { color: theme.colors[look.ink] },
            outdoor && variant === 'ghost' && styles.underline,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.space2,
    minHeight: size.controlLg,
    minWidth: size.touchMin,
    paddingHorizontal: spacing.space6,
    borderRadius: radius.radiusFull,
    alignSelf: 'flex-start',
  },
  small: { minHeight: size.controlMd, paddingHorizontal: spacing.space4 },
  block: { alignSelf: 'stretch' },
  pressed: { transform: [{ scale: 0.97 }] },
  disabled: { opacity: opacity.opacityDisabled },
  underline: { textDecorationLine: 'underline' },
});
