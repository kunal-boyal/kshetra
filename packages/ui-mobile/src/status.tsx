import { radius, size, spacing } from '@thelamp/design-tokens';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from './icon';
import { Text } from './text';
import { type Colors, useTheme } from './theme';

/** The fixed mapping of record states to badge variants (components/StatusBadge). */
export type BadgeVariant = 'success' | 'pending' | 'waiting' | 'info' | 'danger' | 'neutral';

const ink = (variant: BadgeVariant) => `${variant}Fg` as keyof Colors;
const fill = (variant: BadgeVariant) => `${variant}Bg` as keyof Colors;
const edge = (variant: BadgeVariant) => `${variant}Border` as keyof Colors;

/**
 * One record's state as a word with a dot (components/StatusBadge): the word is the meaning, the
 * colour is for scanning. Outdoor's tokens turn it into an outline.
 */
export function StatusBadge({ variant, label }: { variant: BadgeVariant; label: string }) {
  const theme = useTheme();
  const colour = theme.colors[ink(variant)];
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: theme.colors[fill(variant)], borderColor: theme.colors[edge(variant)] },
      ]}
    >
      <View aria-hidden style={[styles.dot, { backgroundColor: colour }]} />
      <Text variant="labelSm" numberOfLines={1} style={{ color: colour }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * What is still on the phone (components/SyncBanner): amber while items wait, red once something
 * was refused, and the whole banner opens the upload queue. It never dismisses itself. In Outdoor
 * it inverts, so glare can't hide it.
 */
export function SyncBanner({
  tone,
  icon,
  message,
  action,
  onPress,
}: {
  tone: 'pending' | 'danger' | 'info';
  icon: LucideIcon;
  message: string;
  /** What tapping does, such as "View". */
  action: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const outdoor = theme.name === 'outdoor';
  const foreground = outdoor ? theme.colors.textInverse : theme.colors[ink(tone)];
  return (
    <Pressable
      role="button"
      aria-label={`${message} ${action}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.banner,
        {
          backgroundColor: outdoor ? theme.colors[ink(tone)] : theme.colors[fill(tone)],
          // A press outlines the banner in its ink.
          borderColor: outdoor || pressed ? theme.colors[ink(tone)] : theme.colors[edge(tone)],
        },
      ]}
    >
      <Icon icon={icon} color={foreground} />
      <Text
        variant="bodySm"
        weight={outdoor ? 600 : 500}
        style={[styles.message, { color: foreground }]}
      >
        {message}
      </Text>
      <Text variant="labelLg" style={[styles.action, { color: foreground }]}>
        {action}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.space1,
    minHeight: 24,
    paddingLeft: spacing.space2,
    paddingRight: spacing.space3,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
  },
  dot: { width: 6, height: 6, borderRadius: radius.radiusFull },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    minHeight: size.touchMin,
    paddingVertical: spacing.space2,
    paddingLeft: spacing.space4,
    paddingRight: spacing.space3,
    borderRadius: radius.radiusLg,
    borderWidth: 1,
  },
  message: { flex: 1 },
  action: { textDecorationLine: 'underline' },
});
