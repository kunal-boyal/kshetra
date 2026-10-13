import { radius, size, spacing } from '@kshetra/design-tokens';
import { Check, ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from './icon';
import { Text } from './text';
import { useTheme } from './theme';

/** Rows grouped on one card, with hairlines between them. */
export function ListGroup({ title, children }: { title?: string; children: ReactNode }) {
  const theme = useTheme();
  const rows = Children.toArray(children);
  return (
    <View style={styles.group}>
      {title ? (
        <Text variant="labelSm" tone="muted" role="heading" style={styles.groupTitle}>
          {title}
        </Text>
      ) : null}
      <View
        style={[
          styles.card,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}
      >
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 ? (
              <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />
            ) : null}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

export interface ListRowProps {
  label: string;
  /** A value or a line of detail under the label. */
  detail?: string;
  icon?: LucideIcon;
  /** Opens something: the row shows a chevron and reads as a button. */
  onPress?: () => void;
  tone?: 'default' | 'danger';
}

/** One row, at least 56 px tall (`row-comfortable`) so a thumb finds it. */
export function ListRow({ label, detail, icon, onPress, tone = 'default' }: ListRowProps) {
  const theme = useTheme();
  const ink = tone === 'danger' ? theme.colors.dangerFg : theme.colors.text;
  const body = (
    <>
      {icon ? <Icon icon={icon} color={ink} /> : null}
      <View style={styles.texts}>
        <Text variant="bodyLg" style={{ color: ink }}>
          {label}
        </Text>
        {detail ? (
          <Text variant="bodySm" tone="muted">
            {detail}
          </Text>
        ) : null}
      </View>
      {onPress && tone !== 'danger' ? (
        <Icon icon={ChevronRight} size="sm" color={theme.colors.textMuted} />
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      role="button"
      aria-label={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.colors.surfaceSunken },
      ]}
    >
      {body}
    </Pressable>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  detail?: string;
}

/** One choice among a few, as radio rows with a check on the chosen one. */
export function ChoiceGroup<T extends string>({
  title,
  choices,
  value,
  onChange,
}: {
  title: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View role="radiogroup" aria-label={title}>
      <ListGroup title={title}>
        {choices.map((choice) => {
          const chosen = choice.value === value;
          return (
            <Pressable
              key={choice.value}
              role="radio"
              aria-checked={chosen}
              aria-label={choice.label}
              onPress={() => onChange(choice.value)}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: theme.colors.surfaceSunken },
              ]}
            >
              <View style={styles.texts}>
                <Text variant="bodyLg" weight={chosen ? 600 : undefined}>
                  {choice.label}
                </Text>
                {choice.detail ? (
                  <Text variant="bodySm" tone="muted">
                    {choice.detail}
                  </Text>
                ) : null}
              </View>
              {chosen ? <Icon icon={Check} color={theme.colors.accent} /> : null}
            </Pressable>
          );
        })}
      </ListGroup>
    </View>
  );
}

/** Several choices among a few, as rows with a ticked box on each chosen one. */
export function CheckGroup<T extends string>({
  title,
  choices,
  value,
  onChange,
}: {
  title: string;
  choices: readonly Choice<T>[];
  value: readonly T[];
  onChange: (value: T[]) => void;
}) {
  const theme = useTheme();
  return (
    <View role="group" aria-label={title}>
      <ListGroup title={title}>
        {choices.map((choice) => {
          const chosen = value.includes(choice.value);
          return (
            <Pressable
              key={choice.value}
              role="checkbox"
              aria-checked={chosen}
              aria-label={choice.label}
              onPress={() =>
                onChange(
                  chosen
                    ? value.filter((entry) => entry !== choice.value)
                    : [...value, choice.value],
                )
              }
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: theme.colors.surfaceSunken },
              ]}
            >
              <View
                style={[
                  styles.box,
                  {
                    borderColor: chosen ? theme.colors.accent : theme.colors.borderStrong,
                    backgroundColor: chosen ? theme.colors.accent : 'transparent',
                  },
                ]}
              >
                {chosen ? <Icon icon={Check} size="sm" color={theme.colors.textInverse} /> : null}
              </View>
              <View style={styles.texts}>
                <Text variant="bodyLg" weight={chosen ? 600 : undefined}>
                  {choice.label}
                </Text>
                {choice.detail ? (
                  <Text variant="bodySm" tone="muted">
                    {choice.detail}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ListGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.space2 },
  groupTitle: { paddingHorizontal: spacing.space2 },
  card: { borderWidth: 1, borderRadius: radius.radiusLg, overflow: 'hidden' },
  rule: { height: StyleSheet.hairlineWidth, marginLeft: spacing.space4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    minHeight: size.rowComfortable,
    paddingHorizontal: spacing.space4,
    paddingVertical: spacing.space2,
  },
  texts: { flex: 1, gap: spacing.space05 },
  box: {
    width: size.iconMd,
    height: size.iconMd,
    borderWidth: 2,
    borderRadius: radius.radiusXs,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
