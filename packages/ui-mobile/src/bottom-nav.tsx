import { radius, size, spacing } from '@kshetra/design-tokens';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './icon';
import { duration, ease, useReducedMotion } from './motion';
import { Text } from './text';
import { useTheme } from './theme';

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onPress: () => void;
}

/**
 * The mobile app's tabs (components/BottomNav): rounded top corners, labels always shown, and the
 * active tab's icon on an `accent-soft` pill that grows in on `ease-spring`. Never more than five.
 */
export function BottomNav({ items, label }: { items: readonly NavItem[]; label: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      role="tablist"
      aria-label={label}
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {items.map((item) => (
        <Tab key={item.key} item={item} />
      ))}
    </View>
  );
}

function Tab({ item }: { item: NavItem }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [grow] = useState(() => new Animated.Value(item.active ? 1 : 0));
  const outdoor = theme.name === 'outdoor';

  useEffect(() => {
    if (!item.active || reduced) {
      grow.setValue(item.active ? 1 : 0);
      return;
    }
    grow.setValue(0.6);
    Animated.timing(grow, {
      toValue: 1,
      duration: duration.durationBase,
      easing: ease('easeSpring'),
      useNativeDriver: true,
    }).start();
  }, [item.active, reduced, grow]);

  const ink = item.active ? theme.colors.accentSubtleFg : theme.colors.textMuted;
  return (
    <Pressable
      role="tab"
      aria-selected={item.active}
      aria-label={item.label}
      onPress={item.onPress}
      style={styles.tab}
    >
      <View style={styles.pillSlot}>
        {item.active ? (
          <Animated.View
            style={[
              styles.pill,
              { backgroundColor: theme.colors.accentSoft, transform: [{ scale: grow }] },
              outdoor && { borderWidth: 2, borderColor: theme.colors.accent },
            ]}
          />
        ) : null}
        {/* Its own view, so the icon draws above the pill on every platform. */}
        <View>
          <Icon icon={item.icon} size="lg" color={ink} />
        </View>
      </View>
      <Text
        variant="labelSm"
        weight={item.active && outdoor ? 700 : undefined}
        style={{ color: ink }}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.space2,
    borderTopWidth: 1,
    borderTopLeftRadius: radius.radiusXl,
    borderTopRightRadius: radius.radiusXl,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.space1,
    minWidth: size.touchMin,
    height: 68,
  },
  pillSlot: { width: 60, height: 32, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', inset: 0, borderRadius: radius.radiusFull },
});
