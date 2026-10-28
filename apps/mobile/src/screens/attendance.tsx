import { spacing } from '@thelamp/design-tokens';
import { formatDate, formatDateTime, formatMonth, formatNumber } from '@thelamp/i18n';
import { type AttendanceDayResult, newId, REGULARISATION_REASON, todayIn } from '@thelamp/shared';
import {
  AppBar,
  type BadgeVariant,
  Button,
  Card,
  ChoiceGroup,
  IconButton,
  Screen,
  StatusBadge,
  Text,
  TextField,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { CalendarCheck, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { fixable, queueFix, useMyAttendance, useQueuedFixes } from '../attendance';
import { leaveLeft, useLeaveBalances, useLeaveTypes } from '../leave';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useSync } from '../sync';
import { MonthDays, shiftMonth } from './month-days';

type Fix = 'present' | 'half_day';
type DayStatus = AttendanceDayResult['status'];

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
  // Leave is a module of its own (D64): switched off, its card hides.
  const leaveOn = !(config.data?.bundle.settings.modulesOff ?? []).includes('leave_attendance');
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
      <AppBar
        title={t('attendance.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        backLabel={t('common.back')}
      />
      <View style={styles.months}>
        <IconButton icon={ChevronLeft} label={t('attendance.previous')} onPress={() => move(-1)} />
        <Text variant="headingMd" style={styles.month}>
          {formatMonth(period, { locale })}
        </Text>
        <IconButton
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
          <Card style={styles.stack}>
            <MonthGrid
              days={days}
              picked={picked}
              today={today}
              queued={queued}
              onPick={(date) => setPicked(date)}
            />
            <View style={styles.legend}>
              {LEGEND.filter((status) => count(status) > 0).map((status) => (
                <StatusBadge
                  key={status}
                  variant={TONE[status] ?? 'neutral'}
                  label={`${t(`report.day_${status}`)} ${number(count(status))}`}
                />
              ))}
            </View>
            <Text variant="bodySm" tone="muted">
              {t('attendance.days_line', {
                scheduled: number(kept.data.summary.scheduled),
                paid: number(kept.data.summary.paid),
              })}
            </Text>
          </Card>
          <Text variant="bodySm" tone="muted">
            {t('attendance.choose_day')}
          </Text>
          {day ? (
            <DayCard key={day.date} day={day} queuedAs={queued.get(day.date)?.status} />
          ) : null}

          {leaveOn ? <LeaveLeft /> : null}
        </>
      )}
    </Screen>
  );
}

/** The month's days, each filled by its status, a dot on any waiting request. */
function MonthGrid({
  days,
  picked,
  today,
  queued,
  onPick,
}: {
  days: readonly AttendanceDayResult[];
  picked: string | null;
  today: string;
  queued: ReadonlyMap<string, unknown>;
  onPick: (date: string) => void;
}) {
  const { t, locale } = useLanguage();
  const byDate = new Map(days.map((day) => [day.date, day]));
  return (
    <MonthDays
      dates={days.map((day) => day.date)}
      onPick={onPick}
      look={(date) => {
        const day = byDate.get(date)!;
        return {
          label: t('attendance.day_label', {
            date: formatDate(date, { locale }),
            status: t(`report.day_${day.status}`),
          }),
          tone: TONE[day.status],
          selected: date === picked,
          today: date === today,
          marked: queued.has(date) || day.regularisation?.state === 'pending',
        };
      }}
    />
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

/** What is left of the paid leave types this year, three across, and the way to ask (D104). */
function LeaveLeft() {
  const { t, locale } = useLanguage();
  const types = useLeaveTypes().data;
  const balances = useLeaveBalances().data?.data;
  const left = leaveLeft(types ?? [], balances).slice(0, 3);
  if (left.length === 0) return null;
  return (
    <Card style={styles.stack}>
      <View style={styles.spread}>
        <Text variant="headingMd" role="heading" style={styles.grow}>
          {t('attendance.leave_left')}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          label={t('attendance.apply')}
          onPress={() => router.push('/leave/new')}
        />
      </View>
      <View style={styles.three}>
        {left.map(({ type, available }) => (
          <View key={type.key} style={styles.third}>
            <Text variant="headingLg" style={styles.figure}>
              {formatNumber(available, { locale }, { maximumFractionDigits: 1 })}
            </Text>
            <Text variant="bodySm" tone="muted" numberOfLines={1}>
              {type.name[locale]}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  grow: { flex: 1 },
  three: { flexDirection: 'row', gap: spacing.space2 },
  third: { flex: 1, minWidth: 0, alignItems: 'center' },
  figure: { fontVariant: ['tabular-nums'] },
  stack: { gap: spacing.space3 },
  months: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month: { flex: 1, textAlign: 'center' },
  summary: { gap: spacing.space2 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.space3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
});
