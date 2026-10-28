import { radius, spacing } from '@thelamp/design-tokens';
import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ProgressBar } from './measures';
import { type Hue, IconChip } from './surfaces';
import { Text } from './text';
import { useTheme } from './theme';

export interface KpiTileProps {
  label: string;
  icon: LucideIcon;
  hue?: Hue;
  /** The approved actual, formatted and shortened for the tile; pending is never inside it. */
  value: string;
  /** Shares of the target, from 0 to 1: approved, then pending after it. Null without a target. */
  progress: { done: number; pending: number } | null;
  /** The foot's first part: attainment of the target, or that there is none. */
  foot: string;
  /** "+N pending", shown apart; leave out when nothing waits. */
  pending?: string | undefined;
  /** A mark beside the label, such as a draft target's badge. */
  badge?: ReactNode;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * One metric's approved actual against its target, pending work apart (components/KpiTile). Tiles
 * go two-up on a phone, so the value never wraps.
 */
export function KpiTile({ label, icon, hue, value, progress, foot, pending, badge }: KpiTileProps) {
  const theme = useTheme();
  const done = progress ? clamp(progress.done) : 0;
  const waiting = progress ? Math.min(clamp(progress.pending), 1 - done) : 0;
  return (
    <View
      style={[
        styles.tile,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          boxShadow: theme.shadows.shadowSm,
        },
      ]}
    >
      <View style={styles.head}>
        <IconChip icon={icon} {...(hue ? { hue } : {})} />
        <Text variant="labelSm" tone="muted" numberOfLines={2} style={styles.label}>
          {label}
        </Text>
      </View>
      {badge}
      <Text variant="metricXl" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <ProgressBar
        parts={
          progress
            ? [
                { value: done, tone: 'done' },
                { value: waiting, tone: 'pending' },
              ]
            : []
        }
      />
      <Text variant="labelSm" tone="muted">
        {foot}
      </Text>
      {pending ? (
        <Text variant="labelSm" weight={600} style={{ color: theme.colors.pendingFg }}>
          {pending}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: radius.radiusLg,
    padding: spacing.space4,
    gap: spacing.space2,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  label: { flex: 1 },
});
