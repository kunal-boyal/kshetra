import { radius, size, spacing } from '@thelamp/design-tokens';
import { Check, X } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { Icon } from './icon';
import { Text } from './text';
import { type Colors, useTheme } from './theme';

export interface ProgressPart {
  /** A share of the whole, from 0 to 1. */
  value: number;
  tone: 'done' | 'pending' | 'danger';
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const percent = (value: number) => `${Math.round(clamp(value) * 1000) / 10}%` as const;

const FILL: Record<ProgressPart['tone'], keyof Colors> = {
  done: 'accent',
  pending: 'pendingSolid',
  danger: 'dangerSolid',
};

/**
 * A whole and its parts in one bar, 8 px tall (`ks-bar`): what is done, then what waits, then what
 * went wrong, in that order. The parts never add up past the whole.
 */
export function ProgressBar({ parts, label }: { parts: readonly ProgressPart[]; label?: string }) {
  const theme = useTheme();
  // Each part takes what the ones before it left of the whole.
  const shown = parts.reduce<ProgressPart[]>((taken, part) => {
    const used = taken.reduce((sum, entry) => sum + entry.value, 0);
    return [...taken, { ...part, value: Math.min(clamp(part.value), 1 - used) }];
  }, []);
  const done = shown.find((part) => part.tone === 'done')?.value ?? 0;
  return (
    <View
      {...(label
        ? {
            accessible: true,
            role: 'progressbar' as const,
            'aria-label': label,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': Math.round(done * 100),
          }
        : { 'aria-hidden': true })}
      style={[styles.bar, { backgroundColor: theme.colors.surfaceSunken }]}
    >
      {shown.map((part, index) => (
        <View
          key={index}
          style={{ width: percent(part.value), backgroundColor: theme.colors[FILL[part.tone]] }}
        />
      ))}
    </View>
  );
}

export interface Step {
  state: 'done' | 'current' | 'rejected' | 'todo';
  title: string;
  meta?: string;
}

/** A sequence with where it stands (components/Steps): done, now, turned down, still to come. */
export function Steps({ label, steps }: { label: string; steps: readonly Step[] }) {
  const theme = useTheme();
  return (
    <View role="list" aria-label={label}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const node =
          step.state === 'done'
            ? { fill: theme.colors.successSolid, edge: theme.colors.successSolid }
            : step.state === 'rejected'
              ? { fill: theme.colors.dangerSolid, edge: theme.colors.dangerSolid }
              : step.state === 'current'
                ? { fill: theme.colors.surface, edge: theme.colors.waitingSolid }
                : { fill: theme.colors.surface, edge: theme.colors.borderStrong };
        return (
          // Each step is read as one item: its title, then its line.
          <View key={index} accessible role="listitem" style={styles.step}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.node,
                  { backgroundColor: node.fill, borderColor: node.edge },
                  step.state === 'current' && {
                    boxShadow: `0 0 0 4px ${theme.colors.waitingBg}`,
                  },
                ]}
              >
                {step.state === 'done' ? (
                  <Icon icon={Check} size="sm" color={theme.colors.surface} />
                ) : step.state === 'rejected' ? (
                  <Icon icon={X} size="sm" color={theme.colors.surface} />
                ) : step.state === 'current' ? (
                  <View style={[styles.dot, { backgroundColor: theme.colors.waitingSolid }]} />
                ) : null}
              </View>
              {last ? null : (
                <View style={[styles.line, { backgroundColor: theme.colors.border }]} />
              )}
            </View>
            <View style={[styles.texts, !last && styles.gap]}>
              <Text
                variant="labelLg"
                weight={600}
                tone={step.state === 'todo' ? 'muted' : 'default'}
              >
                {step.title}
              </Text>
              {step.meta ? (
                <Text variant="bodySm" tone="muted">
                  {step.meta}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const NODE = 24;

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', height: 8, borderRadius: radius.radiusFull, overflow: 'hidden' },
  step: { flexDirection: 'row', gap: spacing.space3 },
  rail: { width: NODE, alignItems: 'center' },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: radius.radiusFull,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 8, height: 8, borderRadius: radius.radiusFull },
  line: { flex: 1, width: 2, marginVertical: spacing.space1, borderRadius: radius.radiusFull },
  texts: { flex: 1, gap: spacing.space05, minHeight: size.iconLg },
  gap: { paddingBottom: spacing.space4 },
});
