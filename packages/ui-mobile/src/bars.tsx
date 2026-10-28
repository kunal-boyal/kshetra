import { radius, size, spacing } from '@thelamp/design-tokens';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './icon';
import { Text } from './text';
import { useTheme } from './theme';

/** A count as a badge shows it: nothing at 0, "99+" past 99. */
export const countText = (count: number) => (count > 99 ? '99+' : String(count));

/**
 * The head of a screen above the tabs (components/PhoneParts): a 44 px way back, the title and a
 * line under it, and one action at its end.
 */
export function AppBar({
  title,
  subtitle,
  onBack,
  backLabel,
  action,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** What going back opens, such as "Back to the visit". */
  backLabel?: string;
  action?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.appbar, !onBack && styles.appbarFlush]}>
      {onBack ? (
        <Pressable
          role="button"
          aria-label={backLabel ?? title}
          onPress={onBack}
          style={({ pressed }) => [
            styles.back,
            pressed && { backgroundColor: theme.colors.surfaceSunken },
          ]}
        >
          <Icon icon={ChevronLeft} color={theme.colors.text} />
        </Pressable>
      ) : null}
      <View style={styles.titles}>
        <Text variant="headingMd" role="heading" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="bodySm" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

/**
 * A screen's actions held at its foot, above the safe area (components/PhoneParts): the surface
 * with an edge above, buttons side by side.
 */
export function ActionBar({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.actions,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          paddingBottom: Math.max(insets.bottom, spacing.space3),
        },
      ]}
    >
      {children}
    </View>
  );
}

/**
 * What a cart holds and the way to review it (components/PhoneParts): a 56 px accent bar with the
 * number of items, the total and the action.
 */
export function CartBar({
  count,
  total,
  note,
  action,
  onPress,
}: {
  /** Such as "4 items". */
  count: string;
  total: string;
  /** Beside the total, such as "+ GST". */
  note?: string;
  action: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const ink = theme.colors.onAccent;
  return (
    <Pressable
      role="button"
      aria-label={`${action}: ${count}, ${total}${note ? ` ${note}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cart,
        {
          backgroundColor: pressed ? theme.colors.accentHover : theme.colors.accent,
          boxShadow: theme.shadows.shadowMd,
        },
      ]}
    >
      <Text variant="labelMd" weight={600} style={{ color: ink }}>
        {count}
      </Text>
      <Text variant="labelLg" weight={700} style={[styles.total, { color: ink }]}>
        {total}
        {note ? (
          <Text variant="caption" style={{ color: ink }}>
            {` ${note}`}
          </Text>
        ) : null}
      </Text>
      <Text variant="labelMd" weight={600} style={{ color: ink }}>
        {action}
      </Text>
      <Icon icon={ChevronRight} color={ink} />
    </Pressable>
  );
}

/**
 * An action shown as its icon alone, 44 px, named for screen readers, with an optional count
 * (`ks-count`), such as the inbox with what is new.
 */
export function IconButton({
  icon,
  label,
  count = 0,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      role="button"
      aria-label={count > 0 ? `${label}, ${countText(count)}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.icon,
        pressed && { backgroundColor: theme.colors.surfaceSunken },
      ]}
    >
      <Icon icon={icon} color={theme.colors.text} />
      {count > 0 ? <Count count={count} /> : null}
    </Pressable>
  );
}

/** A small red count over an icon (`ks-count`). */
export function Count({ count }: { count: number }) {
  const theme = useTheme();
  return (
    <View aria-hidden style={[styles.count, { backgroundColor: theme.colors.dangerSolid }]}>
      <Text variant="caption" weight={700} style={{ color: theme.colors.onDanger }}>
        {countText(count)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  appbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space1,
    minHeight: size.touchMin + spacing.space4,
    paddingVertical: spacing.space2,
    paddingLeft: spacing.space2,
    paddingRight: spacing.space4,
  },
  appbarFlush: { paddingLeft: spacing.space4 },
  back: {
    width: size.touchMin,
    height: size.touchMin,
    borderRadius: radius.radiusFull,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: { flex: 1, minWidth: 0 },
  actions: {
    flexDirection: 'row',
    gap: spacing.space3,
    paddingTop: spacing.space3,
    paddingHorizontal: spacing.space4,
    borderTopWidth: 1,
  },
  cart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    minHeight: size.rowComfortable,
    marginHorizontal: spacing.space3,
    marginBottom: spacing.space2,
    paddingHorizontal: spacing.space4,
    borderRadius: radius.radiusMd,
  },
  total: { flex: 1, fontVariant: ['tabular-nums'] },
  icon: {
    width: size.touchMin,
    height: size.touchMin,
    borderRadius: radius.radiusFull,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: radius.radiusFull,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
