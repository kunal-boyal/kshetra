import { radius, spacing } from '@thelamp/design-tokens';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { pastel, type Hue } from './surfaces';
import { Text } from './text';
import { useTheme } from './theme';

const SIDE = 88;
const STROKE = 9;
const R = (SIDE - STROKE) / 2 - 0.5;

/**
 * A score out of 100 as a ring (components/PhoneParts): `brand-gold` round the share it reached on
 * a faint `on-brand` track, the number in its middle. It is drawn on the product's Forest panel
 * (decision D72), never a tenant's colour. Named for screen readers as `label`; with no score the
 * ring stays empty and the middle says so.
 */
export function ScoreRing({ value, label }: { value: number | null; label: string }) {
  const theme = useTheme();
  const ink = theme.colors.onBrand;
  const share = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <View accessible role="img" aria-label={label} style={styles.ring}>
      <Svg width={SIDE} height={SIDE} viewBox={`0 0 ${SIDE} ${SIDE}`}>
        <Circle
          cx={SIDE / 2}
          cy={SIDE / 2}
          r={R}
          fill="none"
          stroke={ink}
          strokeOpacity={0.22}
          strokeWidth={STROKE}
        />
        {share > 0 ? (
          <Circle
            cx={SIDE / 2}
            cy={SIDE / 2}
            r={R}
            fill="none"
            stroke={theme.colors.brandGold}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${(share / 100) * 2 * Math.PI * R} ${2 * Math.PI * R}`}
            transform={`rotate(-90 ${SIDE / 2} ${SIDE / 2})`}
          />
        ) : null}
        <SvgText
          x={SIDE / 2}
          y={SIDE / 2 + 8}
          textAnchor="middle"
          fill={ink}
          fontSize={22}
          fontWeight="700"
        >
          {value === null ? '–' : String(value)}
        </SvgText>
      </Svg>
    </View>
  );
}

/**
 * One choice among a few, as a tinted card (components/PhoneParts), such as a leave type with what
 * is left of it: its name in `label-md`, a line under it, and the chosen one ringed in `accent`.
 * A set of them is a radio group, three across.
 */
export function ChoiceCard({
  label,
  detail,
  hue,
  checked,
  onPress,
}: {
  label: string;
  detail?: string;
  hue: Hue;
  checked: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const outdoor = theme.name === 'outdoor';
  return (
    <Pressable
      role="radio"
      aria-checked={checked}
      aria-label={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor:
            checked && !outdoor ? theme.colors[pastel(hue, 'Bg')] : theme.colors.surface,
          borderColor: checked ? theme.colors.accent : theme.colors.border,
          borderWidth: checked ? 2 : 1,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text variant="labelMd" weight={600} numberOfLines={2}>
        {label}
      </Text>
      {detail ? (
        <Text variant="bodySm" tone="muted" numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: { width: SIDE, height: SIDE },
  card: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    gap: spacing.space1,
    paddingHorizontal: spacing.space3,
    paddingVertical: spacing.space2,
    borderRadius: radius.radiusLg,
  },
});
