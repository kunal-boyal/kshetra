import { radius, size, spacing } from '@thelamp/design-tokens';
import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { Button } from './button';
import { Icon } from './icon';
import { Text } from './text';
import { type Colors, useTheme } from './theme';

/** A surface for one thing: white on the warm ground, with a soft shadow (`ks-card`). */
export function Card({ style, tint, ...rest }: ViewProps & { tint?: Hue }) {
  const theme = useTheme();
  // A tinted card (`ks-card tint`) lies flat on its hue's wash; Outdoor keeps it white and ruled.
  const flat = tint && theme.name !== 'outdoor';
  return (
    <View
      style={[
        styles.card,
        flat
          ? {
              backgroundColor: theme.colors[pastel(tint, 'Bg')],
              borderColor: 'transparent',
              borderRadius: radius.radiusXl,
            }
          : {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              boxShadow: tint ? undefined : theme.shadows.shadowSm,
            },
        style,
      ]}
      {...rest}
    />
  );
}

const NOTICE = {
  neutral: { fill: 'surfaceSunken', ink: 'textMuted' },
  info: { fill: 'infoBg', ink: 'infoFg' },
  pending: { fill: 'pendingBg', ink: 'pendingFg' },
  danger: { fill: 'dangerBg', ink: 'dangerFg' },
} as const satisfies Record<string, { fill: keyof Colors; ink: keyof Colors }>;

/**
 * States what a figure or record really is, beside it (components/Notice), never dismissible.
 * Neutral by default; a tone and an icon say when it is news, something waiting, or a problem.
 */
export function Notice({
  children,
  tone = 'neutral',
  icon,
}: {
  children: ReactNode;
  tone?: keyof typeof NOTICE;
  icon?: LucideIcon;
}) {
  const theme = useTheme();
  const look = NOTICE[tone];
  return (
    <View
      style={[
        styles.notice,
        { backgroundColor: theme.colors[look.fill] },
        theme.name === 'outdoor' && {
          borderWidth: 1,
          borderColor: tone === 'neutral' ? theme.colors.border : theme.colors[look.ink],
        },
      ]}
    >
      {icon ? <Icon icon={icon} size="sm" color={theme.colors[look.ink]} /> : null}
      <Text variant="bodySm" style={[styles.noticeText, { color: theme.colors[look.ink] }]}>
        {children}
      </Text>
    </View>
  );
}

export type Hue = 'sky' | 'peach' | 'mint' | 'lilac' | 'butter' | 'rose' | 'sage' | 'sand';
type Capital<T extends string> = T extends `${infer F}${infer R}` ? `${Uppercase<F>}${R}` : T;
export const pastel = (hue: Hue, part: 'Fill' | 'Fg' | 'Bg') =>
  `pastel${(hue.charAt(0).toUpperCase() + hue.slice(1)) as Capital<Hue>}${part}` as keyof Colors;

const CHIP = {
  md: { side: size.iconchipMd, corner: radius.radiusMd, icon: 'md' },
  lg: { side: size.iconchipLg, corner: radius.radiusMd, icon: 'lg' },
  xl: { side: size.iconchipXl, corner: radius.radiusXl, icon: 'xl' },
} as const;

/**
 * What kind of thing a row or tile is: its icon on its pastel hue, never a state
 * (components/IconChip). Without a hue it takes the accent's tint. In Outdoor it turns white with
 * an outline in its ink.
 */
export function IconChip({
  icon,
  hue,
  size: chip = 'md',
}: {
  icon: LucideIcon;
  hue?: Hue;
  size?: keyof typeof CHIP;
}) {
  const theme = useTheme();
  const ink = theme.colors[hue ? pastel(hue, 'Fg') : 'accentSubtleFg'];
  const outdoor = theme.name === 'outdoor';
  const { side, corner, icon: iconSize } = CHIP[chip];
  return (
    <View
      aria-hidden
      style={[
        styles.chip,
        {
          width: side,
          height: side,
          borderRadius: corner,
          backgroundColor: outdoor
            ? theme.colors.surface
            : theme.colors[hue ? pastel(hue, 'Fill') : 'accentSubtle'],
        },
        outdoor && { borderWidth: 2, borderColor: ink },
      ]}
    >
      <Icon icon={icon} size={iconSize} color={ink} />
    </View>
  );
}

/**
 * Says why there is nothing here, what happens next and who acts, with at most one action
 * (components/EmptyState).
 */
export function EmptyState({
  icon,
  hue,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  hue?: Hue;
  title: string;
  children: ReactNode;
  action?: { label: string; icon: LucideIcon; onPress: () => void };
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.empty,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          boxShadow: theme.shadows.shadowSm,
        },
      ]}
    >
      <IconChip icon={icon} {...(hue ? { hue } : {})} size="xl" />
      <Text variant="headingMd" role="heading" style={styles.center}>
        {title}
      </Text>
      <Text variant="bodyMd" tone="muted" style={styles.center}>
        {children}
      </Text>
      {action ? (
        <Button variant="tonal" label={action.label} icon={action.icon} onPress={action.onPress} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.radiusLg,
    padding: spacing.space4,
    gap: spacing.space3,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.space2,
    paddingVertical: spacing.space3,
    paddingHorizontal: spacing.space4,
    borderRadius: radius.radiusMd,
  },
  noticeText: { flex: 1 },
  chip: { alignItems: 'center', justifyContent: 'center' },
  empty: {
    alignItems: 'center',
    gap: spacing.space2,
    paddingVertical: spacing.space8,
    paddingHorizontal: spacing.space6,
    borderWidth: 1,
    borderRadius: radius.radiusXl,
  },
  center: { textAlign: 'center' },
});
