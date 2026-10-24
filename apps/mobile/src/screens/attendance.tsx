import { radius, size, spacing } from '@thelamp/design-tokens';
import { formatDate, formatDateTime, formatMonth, formatNumber } from '@thelamp/i18n';
import { type AttendanceDayResult, newId, REGULARISATION_REASON, todayIn } from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  Card,
  ChoiceGroup,
  ListGroup,
  Screen,
  StatusBadge,
  Text,
  TextField,
  useTheme,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, CalendarCheck, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { fixable, queueFix, useMyAttendance, useQueuedFixes } from '../attendance';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useSync } from '../sync';

type Fix = 'present' | 'half_day';
type DayStatus = AttendanceDayResult['status'];
type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** How each status reads at a glance: the badge variants of components/StatusBadge. */
const TONE: Partial<Record<DayStatus, BadgeVariant>> = {
  present: 'success',
  half_day: 'pending',
  paid_leave: 'info',
  unpaid_leave: 'waiting',
  holiday: 'neutral',
  weekly_off: 'neutral',
  absent: 'danger',
};

const LEGEND: DayStatus[] = [
  'present',
  'half_day',
  'absent',
  'paid_leave',
  'unpaid_leave',
  'holiday',
  'weekly_off',
];

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

function shiftMonth(period: string, by: number): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}

const weekdayOf = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() || 7) as Weekday;

/**
 * Attendance on the phone (spec 8.1, M13): the person's month as a calendar, each day coloured
 * and named by its status (BR-23), with working and paid days (BR-24, BR-25). A day picked shows
 * its hours, holiday and any request to fix it, and a past day can be asked about (BR-28); the
 * request waits on the phone until there is signal. The month read last stays readable offline.
 */
export function AttendanceScreen() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  const today = todayIn(timeZone);
  const thisMonth = today.slice(0, 7);
  const [period, setPeriod] = useState(thisMonth);
  const [picked, setPicked] = useState<string | null>(today);
  const month = useMyAttendance(period);
  const queued = useQueuedFixes();
  const kept = month.data;
  const days = kept?.data.days ?? [];
  const day = days.find((entry) => entry.date === picked) ?? null;
  const count = (status: DayStatus) => days.filter((entry) => entry.status === status).length;
  const number = (value: number) => formatNumber(value, { locale });

  function move(by: number) {
    const next = shiftMonth(period, by);
    setPeriod(next);
    setPicked(next === thisMonth ? today : null);
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <Text variant="headingXl" role="heading">
        {t('attendance.title')}
      </Text>
      <View style={styles.months}>
        <Button
          variant="ghost"
          icon={ChevronLeft}
          label={t('attendance.previous')}
          onPress={() => move(-1)}
        />
        <Text variant="headingMd" style={styles.month}>
          {formatMonth(period, { locale })}
        </Text>
        <Button
          variant="ghost"
          icon={ChevronRight}
          label={t('attendance.next')}
          disabled={period >= thisMonth}
          onPress={() => move(1)}
        />
      </View>

      {!kept ? (
        month.isError ? (
          <View style={styles.stack}>
            <Text tone="danger" role="alert">
              {errorMessage(month.error, t)}
            </Text>
            <Button
              variant="secondary"
              icon={RotateCw}
              label={t('common.retry')}
              onPress={() => void month.refetch()}
            />
          </View>
        ) : (
          <Text tone="muted">{t('common.loading')}</Text>
        )
      ) : (
        <>
          <Text variant="bodySm" tone="muted">
            {t('attendance.read_at', { time: formatDateTime(kept.readAt, { locale, timeZone }) })}
          </Text>
          <Card style={styles.summary}>
            {(
              [
                [t('report.day_present'), number(count('present'))],
                [t('report.day_half_day'), number(count('half_day'))],
                [t('report.day_absent'), number(count('absent'))],
                ...(count('paid_leave') + count('unpaid_leave') > 0
                  ? [
                      [t('report.day_paid_leave'), number(count('paid_leave'))],
                      [t('report.day_unpaid_leave'), number(count('unpaid_leave'))],
                    ]
                  : []),
                [t('report.day_holiday'), number(count('holiday'))],
                [t('report.day_weekly_off'), number(count('weekly_off'))],
                [t('attendance.scheduled'), number(kept.data.summary.scheduled)],
                [t('attendance.paid'), number(kept.data.summary.paid)],
              ] as [string, string][]
            ).map(([label, value]) => (
              <View key={label} style={styles.fact}>
                <Text tone="muted">{label}</Text>
                <Text weight={600}>{value}</Text>
              </View>
            ))}
          </Card>

          <Text tone="muted">{t('attendance.choose_day')}</Text>
          <MonthGrid
            days={days}
            picked={picked}
            queued={queued}
            onPick={(date) => setPicked(date)}
          />

          {day ? (
            <DayCard key={day.date} day={day} queuedAs={queued.get(day.date)?.status} />
          ) : null}

          <ListGroup title={t('attendance.legend')}>
            <View style={styles.legend}>
              {LEGEND.map((status) => (
                <StatusBadge
                  key={status}
                  variant={TONE[status] ?? 'neutral'}
                  label={t(`report.day_${status}`)}
                />
              ))}
            </View>
          </ListGroup>
        </>
      )}
    </Screen>
  );
}

/** The month as weeks from Monday: a cell a day, filled by its status's tone. */
function MonthGrid({
  days,
  picked,
  queued,
  onPick,
}: {
  days: readonly AttendanceDayResult[];
  picked: string | null;
  queued: ReadonlyMap<string, unknown>;
  onPick: (date: string) => void;
}) {
  const { t, locale } = useLanguage();
  const theme = useTheme();
  if (days.length === 0) return null;
  const cells: (AttendanceDayResult | null)[] = [
    ...Array.from({ length: weekdayOf(days[0]!.date) - 1 }, () => null),
    ...days,
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
          {week.map((cell, column) => {
            if (!cell) return <View key={column} style={styles.cell} />;
            const tone = TONE[cell.status];
            const selected = cell.date === picked;
            const waiting = queued.has(cell.date) || cell.regularisation?.state === 'pending';
            return (
              <Pressable
                key={cell.date}
                role="button"
                aria-label={t('attendance.day_label', {
                  date: formatDate(cell.date, { locale }),
                  status: t(`report.day_${cell.status}`),
                })}
                aria-selected={selected}
                onPress={() => onPick(cell.date)}
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
                  {String(Number(cell.date.slice(8)))}
                </Text>
                {waiting ? (
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

/** One day: its status, hours and holiday, any request to fix it, and asking to. */
function DayCard({ day, queuedAs }: { day: AttendanceDayResult; queuedAs: Fix | undefined }) {
  const { t, locale } = useLanguage();
  const { client } = useApp();
  const sync = useSync();
  const config = useConfig();
  const permissions = new Set<string>(config.data?.bundle.access.permissions ?? []);
  const [status, setStatus] = useState<Fix>('present');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fix = day.regularisation;
  const canAsk =
    permissions.has('regularisation.request') &&
    sync !== null &&
    fixable(day, queuedAs !== undefined);

  async function ask() {
    if (!sync || !client.owner) return;
    if (reason.trim().length < REGULARISATION_REASON.min) {
      setError(t('attendance.reason_short'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await queueFix(sync, client.owner, {
        id: newId(),
        date: day.date,
        status,
        reason: reason.trim(),
      });
      await sync.runner.refresh();
      // It goes now if the phone has a connection, and with the next sync if not.
      void sync.runner.sync();
    } catch (caught) {
      setError(errorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.stack}>
      <Text variant="headingMd">{formatDate(day.date, { locale })}</Text>
      <View style={styles.legend}>
        <StatusBadge
          variant={TONE[day.status] ?? 'neutral'}
          label={t(`report.day_${day.status}`)}
        />
      </View>
      {day.hours > 0 ? (
        <Text>
          {t('attendance.hours', {
            hours: formatNumber(day.hours, { locale }, { maximumFractionDigits: 1 }),
          })}
        </Text>
      ) : null}
      {day.holiday ? <Text>{t('attendance.holiday_named', { name: day.holiday })}</Text> : null}
      {queuedAs ? (
        <Text tone="muted">
          {t('attendance.fix_queued', { status: t(`report.day_${queuedAs}`) })}
        </Text>
      ) : fix ? (
        <Text tone="muted">
          {t(`attendance.fix_${fix.state}`, { status: t(`report.day_${fix.status}`) })}
        </Text>
      ) : null}
      {canAsk ? (
        <View style={styles.stack}>
          <Text variant="labelLg">{t('attendance.fix_title')}</Text>
          <ChoiceGroup<Fix>
            title={t('attendance.fix_as')}
            value={status}
            onChange={setStatus}
            choices={[
              { value: 'present', label: t('report.day_present') },
              { value: 'half_day', label: t('report.day_half_day') },
            ]}
          />
          <TextField
            label={t('attendance.reason')}
            required
            multiline
            maxLength={REGULARISATION_REASON.max}
            value={reason}
            onChangeText={(text) => {
              setReason(text);
              setError(undefined);
            }}
            help={t('attendance.reason_help')}
            {...(error ? { error } : {})}
          />
          <Button
            variant="primary"
            icon={CalendarCheck}
            label={t('attendance.ask')}
            busy={busy}
            onPress={() => void ask()}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
  months: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month: { flex: 1, textAlign: 'center' },
  summary: { gap: spacing.space2 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.space3 },
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
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
});
