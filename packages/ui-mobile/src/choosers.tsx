import { radius, size, spacing } from '@thelamp/design-tokens';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Choice } from './lists';
import { Text } from './text';
import { useTheme } from './theme';

/**
 * One choice among a few short ones, as chips that wrap onto more lines (`ks-chips`), such as a
 * product category or a filter. The chosen chip fills with the accent; in Outdoor it is ringed.
 */
export function ChipGroup<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  const outdoor = theme.name === 'outdoor';
  return (
    <View role="radiogroup" aria-label={label} style={styles.chips}>
      {choices.map((choice) => {
        const chosen = choice.value === value;
        return (
          <Pressable
            key={choice.value}
            role="radio"
            aria-checked={chosen}
            aria-label={choice.label}
            onPress={() => onChange(choice.value)}
            hitSlop={(size.touchMin - size.controlMd) / 2}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor:
                  chosen && !outdoor
                    ? theme.colors.accent
                    : pressed
                      ? theme.colors.surfaceSunken
                      : theme.colors.surface,
                borderColor: chosen ? theme.colors.accent : theme.colors.borderStrong,
                borderWidth: chosen && outdoor ? 2 : 1,
              },
            ]}
          >
            <Text
              variant="labelMd"
              weight={600}
              style={{ color: chosen && !outdoor ? theme.colors.onAccent : theme.colors.text }}
            >
              {choice.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Two to four views of one thing as one bar of equal segments (`ks-seg`), such as Today and This
 * week. The chosen segment lifts onto the surface; in Outdoor it is ringed in the accent.
 */
export function SegmentedControl<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  const outdoor = theme.name === 'outdoor';
  return (
    <View
      role="radiogroup"
      aria-label={label}
      style={[
        styles.bar,
        { backgroundColor: theme.colors.surfaceSunken },
        outdoor && { borderWidth: 1, borderColor: theme.colors.border },
      ]}
    >
      {choices.map((choice) => {
        const chosen = choice.value === value;
        return (
          <Pressable
            key={choice.value}
            role="radio"
            aria-checked={chosen}
            aria-label={choice.label}
            onPress={() => onChange(choice.value)}
            style={[
              styles.segment,
              chosen && {
                backgroundColor: theme.colors.surface,
                boxShadow: outdoor ? undefined : theme.shadows.shadowSm,
              },
              chosen && outdoor && { borderWidth: 2, borderColor: theme.colors.accent },
            ]}
          >
            <Text
              variant="labelMd"
              weight={600}
              numberOfLines={1}
              adjustsFontSizeToFit
              tone={chosen ? 'default' : 'muted'}
            >
              {choice.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
  chip: {
    minHeight: size.controlMd,
    paddingHorizontal: spacing.space4,
    borderRadius: radius.radiusFull,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    flexDirection: 'row',
    padding: spacing.space05,
    borderRadius: radius.radiusFull,
    gap: spacing.space05,
  },
  segment: {
    flex: 1,
    minHeight: size.touchMin - 2 * spacing.space05,
    paddingHorizontal: spacing.space3,
    borderRadius: radius.radiusFull,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
