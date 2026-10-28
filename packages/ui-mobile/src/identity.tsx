import { radius, size } from '@thelamp/design-tokens';
import { avatarHue, initialsOf } from '@thelamp/shared';
import { StyleSheet, View } from 'react-native';
import { pastel } from './surfaces';
import { Text } from './text';
import { useTheme } from './theme';

const SIDES = { sm: size.iconchipSm, md: size.iconchipMd, lg: size.iconchipLg } as const;

/**
 * A person without a photo: their initials on their own pastel hue (components/Avatar). The hue
 * comes from their ID by `avatarHue()`, as on the web, so a person looks the same in every app.
 */
export function Avatar({
  name,
  id,
  size: side = 'md',
  label = false,
}: {
  name: string;
  id: string;
  size?: keyof typeof SIDES;
  /** Names the avatar for screen readers; leave out when the name is written beside it. */
  label?: boolean;
}) {
  const theme = useTheme();
  const hue = avatarHue(id);
  const ink = theme.colors[pastel(hue, 'Fg')];
  const outdoor = theme.name === 'outdoor';
  const width = SIDES[side];
  return (
    <View
      {...(label
        ? { accessible: true, role: 'img' as const, 'aria-label': name }
        : { 'aria-hidden': true })}
      style={[
        styles.round,
        {
          width,
          height: width,
          backgroundColor: outdoor ? theme.colors.surface : theme.colors[pastel(hue, 'Fill')],
        },
        outdoor && { borderWidth: 2, borderColor: ink },
      ]}
    >
      <Text variant={side === 'sm' ? 'labelSm' : 'labelMd'} weight={600} style={{ color: ink }}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

/**
 * A place in a sequence on a round seal, such as a stop's order on the day's route (`ks-seq`).
 * `done` fills it with the success colour, `now` with the accent.
 */
export function SeqBadge({ n, tone }: { n: number; tone?: 'done' | 'now' }) {
  const theme = useTheme();
  const fill =
    tone === 'done'
      ? theme.colors.successSolid
      : tone === 'now'
        ? theme.colors.accent
        : theme.colors.surfaceSunken;
  const ink = tone ? theme.colors.onAccent : theme.colors.textMuted;
  return (
    <View aria-hidden style={[styles.seq, { backgroundColor: fill }]}>
      <Text variant="labelSm" weight={600} style={[styles.figures, { color: ink }]}>
        {n}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  round: { borderRadius: radius.radiusFull, alignItems: 'center', justifyContent: 'center' },
  seq: {
    width: size.controlSm,
    height: size.controlSm,
    borderRadius: radius.radiusFull,
    alignItems: 'center',
    justifyContent: 'center',
  },
  figures: { fontVariant: ['tabular-nums'] },
});
