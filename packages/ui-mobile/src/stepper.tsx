import { radius, size } from '@thelamp/design-tokens';
import { Minus, Plus } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from './icon';
import { Text } from './text';
import { useTheme } from './theme';

/**
 * How many of something, stepped one at a time (components/PhoneParts): − on `surface`, the
 * value in tabular figures, + on `accent-subtle`, 44 px tall inside one `border-strong` edge.
 * Pressing the value can open an exact entry, such as another unit or a part of one.
 */
export function QuantityStepper({
  value,
  valueLabel,
  lessLabel,
  moreLabel,
  onLess,
  onMore,
  onValue,
}: {
  /** As shown, such as "40". */
  value: string;
  /** What the value is, for screen readers: "Quantity of NPK 19:19:19, 40". */
  valueLabel: string;
  /** "Fewer NPK 19:19:19". */
  lessLabel: string;
  /** "More NPK 19:19:19". */
  moreLabel: string;
  onLess: () => void;
  onMore: () => void;
  onValue?: () => void;
}) {
  const theme = useTheme();
  const outdoor = theme.name === 'outdoor';
  const figure = (
    <Text variant="labelLg" weight={700} style={styles.figure}>
      {value}
    </Text>
  );
  return (
    <View
      style={[styles.box, { borderColor: theme.colors.borderStrong, borderWidth: outdoor ? 2 : 1 }]}
    >
      <Pressable
        role="button"
        aria-label={lessLabel}
        onPress={onLess}
        style={({ pressed }) => [
          styles.end,
          { backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface },
        ]}
      >
        <Icon icon={Minus} size="sm" color={theme.colors.text} />
      </Pressable>
      {onValue ? (
        <Pressable
          role="button"
          aria-label={valueLabel}
          onPress={onValue}
          style={({ pressed }) => [
            styles.value,
            { backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface },
          ]}
        >
          {figure}
        </Pressable>
      ) : (
        <View
          aria-label={valueLabel}
          style={[styles.value, { backgroundColor: theme.colors.surface }]}
        >
          {figure}
        </View>
      )}
      <Pressable
        role="button"
        aria-label={moreLabel}
        onPress={onMore}
        style={({ pressed }) => [
          styles.end,
          {
            backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.accentSubtle,
          },
        ]}
      >
        <Icon icon={Plus} size="sm" color={theme.colors.accentSubtleFg} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: size.touchMin,
    borderRadius: radius.radiusMd,
    overflow: 'hidden',
  },
  end: { width: size.touchMin - 4, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: size.touchMin - 4, alignItems: 'center', justifyContent: 'center' },
  figure: { fontVariant: ['tabular-nums'], textAlign: 'center' },
});
