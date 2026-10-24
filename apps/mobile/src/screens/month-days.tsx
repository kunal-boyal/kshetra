import { radius, size, spacing } from '@thelamp/design-tokens';
import { type BadgeVariant, Text, useTheme } from '@thelamp/ui-mobile';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLanguage } from '../i18n';

type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export const weekdayOf = (date: string) =>
  (new Date(`${date}T00:00:00Z`).getUTCDay() || 7) as Weekday;

/** Every date of a month (`YYYY-MM`). */
export function monthDates(period: string): string[] {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: last }, (_, at) => `${period}-${String(at + 1).padStart(2, '0')}`);
}

/** The month `by` months from `period`. */
export function shiftMonth(period: string, by: number): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1 + by, 1)).toISOString().slice(0, 7);
}

/** How one day looks in the grid. */
export interface DayLook {
  /** Its accessible name: the date and what it is. */
  label: string;
  /** Filled with a status's badge tone (components/StatusBadge). */
  tone?: BadgeVariant | undefined;
  selected?: boolean;
  /** A dot for something waiting, such as a request still to upload. */
  marked?: boolean;
}

/**
 * A month as weeks from Monday (spec 8.1): a cell a day, each pressable, filled by its tone and
 * named in full for screen readers. Attendance colours days by status; leave picks a range.
 */
export function MonthDays({
  dates,
  look,
  onPick,
}: {
  dates: readonly string[];
  look: (date: string) => DayLook;
  onPick: (date: string) => void;
}) {
  const { t } = useLanguage();
  const theme = useTheme();
  if (dates.length === 0) return null;
  const cells: (string | null)[] = [
    ...Array.from({ length: weekdayOf(dates[0]!) - 1 }, () => null),
    ...dates,
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, at) =>
    cells.slice(at * 7, at * 7 + 7),
  );

  return (
    <View style={styles.grid}>
      <View style={styles.week}>
        {WEEKDAYS.map((weekday) => (
          <Text key={weekday} variant="labelSm" tone="muted" style={styles.weekday}>
            {t(`attendance.weekday_short_${weekday}`)}
          </Text>
        ))}
      </View>
      {weeks.map((week, row) => (
        <View key={row} style={styles.week}>
          {week.map((date, column) => {
            if (!date) return <View key={column} style={styles.cell} />;
            const { label, tone, selected = false, marked = false } = look(date);
            return (
              <Pressable
                key={date}
                role="button"
                testID={`day-${date}`}
                aria-label={label}
                aria-selected={selected}
                onPress={() => onPick(date)}
                style={[
                  styles.cell,
                  styles.day,
                  {
                    backgroundColor: tone ? theme.colors[`${tone}Bg`] : theme.colors.surface,
                    borderColor: selected
                      ? theme.colors.focusRing
                      : tone
                        ? theme.colors[`${tone}Border`]
                        : theme.colors.border,
                    borderWidth: selected ? 2 : 1,
                  },
                ]}
              >
                <Text
                  weight={selected ? 700 : 500}
                  style={{ color: tone ? theme.colors[`${tone}Fg`] : theme.colors.textMuted }}
                >
                  {String(Number(date.slice(8)))}
                </Text>
                {marked ? (
                  <View
                    aria-hidden
                    style={[styles.mark, { backgroundColor: theme.colors.pendingFg }]}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: spacing.space1 },
  week: { flexDirection: 'row', gap: spacing.space1 },
  weekday: { flex: 1, textAlign: 'center' },
  cell: { flex: 1, minHeight: size.touchMin },
  day: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.radiusSm,
  },
  mark: {
    position: 'absolute',
    bottom: spacing.space1,
    width: spacing.space1,
    height: spacing.space1,
    borderRadius: radius.radiusFull,
  },
});
