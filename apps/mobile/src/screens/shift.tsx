import type { ShiftState } from '@thelamp/api-client/sync';
import { spacing } from '@thelamp/design-tokens';
import { formatDateTime, formatNumber } from '@thelamp/i18n';
import { punchFixIssue } from '@thelamp/shared';
import { Button, Card, ChoiceGroup, ShiftCard, type ShiftAction, Text } from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { LogOut, Pause, Play, Power } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { currentFix } from '../location';
import { useSync, useSyncStatus } from '../sync';
import { pauseShift, punchOut, resumeShift, startTracking, trackingRuns } from '../tracking';
import { useTodayPlan } from './today-plan';

/**
 * The person's shift on this phone, and whether recording runs, read again whenever the sync's
 * status moves (every punch saves through it) and every minute.
 */
export function useShift() {
  const { client } = useApp();
  const sync = useSync();
  const status = useSyncStatus();
  const [found, setFound] = useState<{ state: ShiftState | null; running: boolean }>();
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  useEffect(() => {
    const owner = client.owner;
    if (!sync || !owner) return;
    let live = true;
    void Promise.all([sync.tracking.current(owner), trackingRuns()]).then(([state, running]) => {
      if (live) setFound({ state, running });
    });
    return () => {
      live = false;
    };
  }, [sync, client, status, tick]);
  // The time on duty moves on while the card shows.
  useEffect(() => {
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { ...found, refresh };
}

const PAUSE_REASONS = ['break', 'personal', 'no_signal', 'other'] as const;
type PauseReason = (typeof PAUSE_REASONS)[number];

/** Hours and minutes, as the card shows time on duty. */
function sinceStart(startedAt: number, t: ReturnType<typeof useLanguage>['t']): string {
  const minutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60_000));
  return t('shift.duration', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/**
 * The shift on Home (components/ShiftCard): off duty, on duty, paused, or not recording when the
 * phone stopped tracking by itself. Every action saves on the phone first.
 */
export function ShiftSection() {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const sync = useSync();
  const status = useSyncStatus();
  const config = useConfig();
  const shift = useShift();
  const plan = useTodayPlan();
  const [pausing, setPausing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const bundle = config.data?.bundle;
  const permissions = new Set<string>(bundle?.access.permissions ?? []);
  if (!permissions.has('shift.use') || shift.state === undefined || !sync || !client.owner) {
    return null;
  }
  const owner = client.owner;
  const timeZone = bundle?.settings.timezone ?? 'Asia/Kolkata';
  const notice = { title: t('shift.notice_title'), body: t('shift.notice_body') };
  const state = shift.state;
  const note = t('shift.tracking_note');

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      await sync!.runner.refresh();
      void sync!.runner.sync();
    } catch {
      setError(t('shift.not_saved'));
    } finally {
      setBusy(false);
      shift.refresh();
    }
  }

  async function end() {
    const fix = await currentFix();
    if (fix.status !== 'ready') {
      setError(t(fix.status === 'denied' ? 'shift.fix_denied' : 'shift.fix_unavailable'));
      return;
    }
    const issue = punchFixIssue(fix.fix);
    if (issue) {
      setError(t(issue === 'GPS_MOCKED' ? 'shift.fix_mocked' : 'shift.fix_vague'));
      return;
    }
    await act(() => punchOut(sync!, owner, fix.fix));
    setEnding(false);
  }

  if (!state) {
    return (
      <ShiftCard
        state="off"
        title={t('shift.off_duty')}
        note={note}
        actions={[
          {
            label: t('shift.punch_in'),
            icon: Power,
            primary: true,
            onPress: () => router.push('/punch-in'),
          },
        ]}
      />
    );
  }

  const paused = state.pauseId !== null;
  // Visits today are the day's plan items visited or done (spec 8.1).
  const visitsToday = plan.items.filter(
    (item) => item.status === 'visited' || item.status === 'completed',
  ).length;
  const stopped = !paused && !shift.running;
  const unsent = (status?.counts.queued ?? 0) > 0;
  const endAction: ShiftAction = {
    label: t('shift.punch_out'),
    icon: LogOut,
    tonal: true,
    busy,
    // The odometer at punch-out has its own screen (decision D99); otherwise End day asks first
    // only when something is still on the phone (components/ShiftCard).
    onPress: () =>
      bundle?.settings.odometer && bundle.settings.odometer !== 'off'
        ? router.push('/punch-out')
        : unsent
          ? setEnding(true)
          : void end(),
  };
  const actions: ShiftAction[] = paused
    ? [
        {
          label: t('shift.resume'),
          icon: Play,
          primary: true,
          busy,
          onPress: () =>
            void act(async () => {
              await resumeShift(sync, owner);
              await startTracking(state.intervalSeconds, notice);
            }),
        },
        endAction,
      ]
    : stopped
      ? [
          {
            label: t('shift.record_again'),
            icon: Play,
            primary: true,
            busy,
            onPress: () =>
              void act(async () => {
                if (!(await startTracking(state.intervalSeconds, notice))) {
                  router.push('/tracking-help');
                }
              }),
          },
          endAction,
        ]
      : [
          { label: t('shift.pause'), icon: Pause, busy, onPress: () => setPausing(true) },
          endAction,
        ];

  return (
    <View style={styles.stack}>
      <ShiftCard
        state={paused ? 'paused' : stopped ? 'stopped' : 'on'}
        title={t('shift.on_duty_since', {
          time: formatDateTime(new Date(state.startedAt), { locale, timeZone }),
        })}
        badge={t(paused ? 'shift.paused' : stopped ? 'shift.not_recording' : 'shift.tracking')}
        stats={[
          { value: sinceStart(state.startedAt, t), label: t('shift.stat_on_duty') },
          // Counted on the phone from the points it keeps, so only about; the trail is the record.
          {
            value: t('shift.stat_km', {
              km: formatNumber(
                state.distanceMeters / 1000,
                { locale },
                { minimumFractionDigits: 1, maximumFractionDigits: 1 },
              ),
            }),
            label: t('shift.stat_travelled'),
          },
          {
            value: formatNumber(visitsToday, { locale }),
            label: t('shift.stat_visits', { count: visitsToday }),
          },
        ]}
        note={note}
        actions={actions}
        {...(stopped
          ? { fix: { label: t('shift.fix_it'), onPress: () => router.push('/tracking-help') } }
          : {})}
      />
      {pausing ? (
        <Card style={styles.stack}>
          <ChoiceGroup<PauseReason | ''>
            title={t('shift.pause_why')}
            value=""
            choices={PAUSE_REASONS.map((reason) => ({
              value: reason,
              label: t(`shift.pause_${reason}`),
            }))}
            onChange={(reason) => {
              if (!reason) return;
              setPausing(false);
              void act(() => pauseShift(sync, owner, t(`shift.pause_${reason}`)));
            }}
          />
          <Button variant="ghost" label={t('common.cancel')} onPress={() => setPausing(false)} />
        </Card>
      ) : null}
      {ending ? (
        <Card style={styles.stack} role="group" aria-label={t('shift.end_question')}>
          <Text>{t('shift.end_question')}</Text>
          <View style={styles.row}>
            <Button
              variant="primary"
              icon={LogOut}
              label={t('shift.punch_out')}
              busy={busy}
              onPress={() => void end()}
            />
            <Button variant="ghost" label={t('common.cancel')} onPress={() => setEnding(false)} />
          </View>
        </Card>
      ) : null}
      {error ? (
        <Text tone="danger" role="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
});
