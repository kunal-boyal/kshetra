import { radius, spacing } from '@thelamp/design-tokens';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Button } from './button';
import { duration, ease, useReducedMotion } from './motion';
import { StatusBadge } from './status';
import { Card } from './surfaces';
import { Text } from './text';
import { useTheme } from './theme';

export type ShiftCardState = 'off' | 'on' | 'paused' | 'stopped';

export interface ShiftAction {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  /** At most one: Start day off duty, Resume while paused. */
  primary?: boolean;
  /** End day on duty, on the accent's tint (the prototype's Punch out). */
  tonal?: boolean;
  busy?: boolean;
}

export interface ShiftCardProps {
  state: ShiftCardState;
  /** "Off duty", or "On duty since 09:12". */
  title: string;
  /** The tracking badge: "Tracking", "Paused" or "Not recording". */
  badge?: string;
  /** Time on duty, in `metric-md`. */
  metric?: string;
  /** Distance and visits. */
  detail?: string;
  /** On duty: time, distance and visits, three across, each a figure over its word. */
  stats?: readonly { value: string; label: string }[];
  /** The tracking explanation from the copy table; never hidden. */
  note: string;
  actions: readonly ShiftAction[];
  /** When recording stopped unexpectedly: the fix-it link. */
  fix?: { label: string; onPress: () => void };
}

const BADGE = { on: 'success', paused: 'pending', stopped: 'danger' } as const;

/** The live dot (`ks-live`): green and pulsing once per `duration-loop` while live, grey off. */
export function LiveDot({ live }: { live: boolean }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!live || reduced) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: duration.durationLoop,
        easing: ease('easeExit'),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [live, reduced, pulse]);
  const solid = live ? theme.colors.successSolid : theme.colors.neutralSolid;
  const halo = live ? theme.colors.successBg : theme.colors.neutralBg;
  return (
    <View aria-hidden style={[styles.halo, { backgroundColor: halo }]}>
      <View style={[styles.dot, { backgroundColor: solid }]}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.round,
            {
              backgroundColor: solid,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
              transform: [
                { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) },
              ],
            },
          ]}
        />
      </View>
    </View>
  );
}

/**
 * The shift card on Home (components/ShiftCard): whether the person is on duty, with the start,
 * pause and end actions. Its state comes from the phone, so it works offline.
 */
export function ShiftCard({
  state,
  title,
  badge,
  metric,
  detail,
  stats,
  note,
  actions,
  fix,
}: ShiftCardProps) {
  const theme = useTheme();
  return (
    <Card style={styles.card} role="group" aria-label={title}>
      <View style={styles.row}>
        <LiveDot live={state === 'on'} />
        <Text variant="headingMd" style={styles.grow}>
          {title}
        </Text>
        {state !== 'off' && badge ? <StatusBadge variant={BADGE[state]} label={badge} /> : null}
      </View>
      {stats && state !== 'off' ? (
        <View style={styles.stats}>
          {stats.map((stat) => (
            <View key={stat.label} style={styles.stat}>
              <Text variant="metricMd" style={styles.figures}>
                {stat.value}
              </Text>
              <Text variant="bodySm" tone="muted">
                {stat.label}
              </Text>
            </View>
          ))}
        </View>
      ) : metric ? (
        <Text variant="metricMd">{metric}</Text>
      ) : null}
      {detail ? <Text tone="muted">{detail}</Text> : null}
      <Text variant="bodySm" tone="muted">
        {note}
      </Text>
      {fix ? (
        <Pressable role="link" aria-label={fix.label} onPress={fix.onPress} style={styles.link}>
          <Text variant="labelMd" style={{ color: theme.colors.dangerFg }}>
            {fix.label}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.actions}>
        {actions.map((action) => (
          <Button
            key={action.label}
            variant={action.primary ? 'primary' : action.tonal ? 'tonal' : 'secondary'}
            icon={action.icon}
            label={action.label}
            onPress={action.onPress}
            {...(action.busy ? { busy: true } : {})}
          />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.space3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  grow: { flex: 1 },
  stats: { flexDirection: 'row', gap: spacing.space2 },
  stat: { flex: 1, minWidth: 0 },
  figures: { fontVariant: ['tabular-nums'] },
  halo: {
    width: 18,
    height: 18,
    borderRadius: radius.radiusFull,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 10, height: 10, borderRadius: radius.radiusFull },
  round: { borderRadius: radius.radiusFull },
  link: { alignSelf: 'flex-start', paddingVertical: spacing.space1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
});
