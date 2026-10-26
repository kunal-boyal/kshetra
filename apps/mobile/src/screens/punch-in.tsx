import { spacing } from '@thelamp/design-tokens';
import { punchFixIssue, type PunchOdometer } from '@thelamp/shared';
import { Button, Card, Notice, Screen, Text } from '@thelamp/ui-mobile';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, Camera, Check, Crosshair, MapPin } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { takeResults } from '../capture-results';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { currentFix, type Fix } from '../location';
import { useSync } from '../sync';
import { punchIn, startTracking } from '../tracking';
import { OdometerStep } from './odometer-step';

const SELFIE_REQUEST = 'punch-in-selfie';
const ODOMETER_REQUEST = 'punch-in-odometer';

/** What the steps have gathered so far. */
interface Gathered {
  fix: Fix;
  selfieMediaId?: string;
  odometer?: PunchOdometer;
}

type Step =
  | { name: 'consent' }
  | { name: 'locating' }
  | ({ name: 'selfie' } & Gathered)
  | ({ name: 'odometer' } & Gathered)
  | ({ name: 'background' } & Gathered)
  | { name: 'saving' };

/**
 * Punching in (M5): the consent sheet in the person's language, a fresh fix of 250 m or better
 * that isn't mocked, a selfie and the odometer when the tenant asks (decision D99), and the
 * background permission, explained in the app before the system asks (spec 12.1). The shift is saved on the phone first and sent when
 * there is signal; tracking starts at once.
 */
export function PunchInScreen() {
  const { client } = useApp();
  const { t } = useLanguage();
  const sync = useSync();
  const config = useConfig();
  const settings = config.data?.bundle.settings;
  const [step, setStep] = useState<Step>({ name: 'consent' });
  const [problem, setProblem] = useState<string>();
  const waitingForSelfie = useRef(false);
  const minutes = Math.max(1, Math.round((settings?.gpsIntervalSeconds ?? 60) / 60));
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  async function locate() {
    setProblem(undefined);
    setStep({ name: 'locating' });
    const state = await currentFix();
    if (state.status !== 'ready') {
      setProblem(t(state.status === 'denied' ? 'shift.fix_denied' : 'shift.fix_unavailable'));
      setStep({ name: 'consent' });
      return;
    }
    const issue = punchFixIssue(state.fix);
    if (issue) {
      setProblem(t(issue === 'GPS_MOCKED' ? 'shift.fix_mocked' : 'shift.fix_vague'));
      setStep({ name: 'consent' });
      return;
    }
    setStep(after('locating', { fix: state.fix }));
  }

  /** The step after `from`, skipping what the tenant doesn't ask for. */
  function after(from: 'locating' | 'selfie' | 'odometer', gathered: Gathered): Step {
    // Only what was gathered goes on: the step it came from may carry its own name.
    const { fix, selfieMediaId, odometer } = gathered;
    const kept: Gathered = {
      fix,
      ...(selfieMediaId ? { selfieMediaId } : {}),
      ...(odometer ? { odometer } : {}),
    };
    if (from === 'locating' && settings?.attendanceSelfie) return { name: 'selfie', ...kept };
    if (from !== 'odometer' && settings && settings.odometer !== 'off') {
      return { name: 'odometer', ...kept };
    }
    return { name: 'background', ...kept };
  }

  // Back from the camera with the selfie.
  useFocusEffect(
    useCallback(() => {
      if (!waitingForSelfie.current) return;
      const [mediaId] = takeResults(SELFIE_REQUEST);
      if (!mediaId) return;
      waitingForSelfie.current = false;
      setStep((current) =>
        current.name === 'selfie'
          ? after('selfie', { ...current, selfieMediaId: mediaId })
          : current,
      );
      // `after` reads the settings, which a focus brings back.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings]),
  );

  async function start({ fix, selfieMediaId, odometer }: Gathered) {
    if (!sync || !client.owner || !settings) return;
    setProblem(undefined);
    // The system asks only after the app has said why (spec 12.1, Play's prominent disclosure).
    const background =
      Platform.OS === 'web'
        ? { granted: false }
        : await Location.requestBackgroundPermissionsAsync();
    setStep({ name: 'saving' });
    try {
      await punchIn(sync, client.owner, {
        fix,
        maxShiftHours: settings.maxShiftHours,
        intervalSeconds: settings.gpsIntervalSeconds,
        timeZone: settings.timezone,
        ...(selfieMediaId ? { selfieMediaId } : {}),
        ...(odometer ? { odometer } : {}),
      });
      await sync.runner.refresh();
      void sync.runner.sync();
    } catch {
      setProblem(t('shift.not_saved'));
      setStep({
        name: 'background',
        fix,
        ...(selfieMediaId ? { selfieMediaId } : {}),
        ...(odometer ? { odometer } : {}),
      });
      return;
    }
    const started =
      background.granted &&
      (await startTracking(settings.gpsIntervalSeconds, {
        title: t('shift.notice_title'),
        body: t('shift.notice_body'),
      }).catch(() => false));
    if (started) router.replace('/');
    else router.replace('/tracking-help');
  }

  return (
    <Screen>
      <Button variant="ghost" icon={ArrowLeft} label={t('common.back')} onPress={back} />
      <Text variant="headingXl" role="heading">
        {t('shift.consent_title')}
      </Text>
      <Card style={styles.stack}>
        {(
          [
            t('shift.consent_interval', { count: minutes }),
            t('shift.consent_screen_off'),
            t('shift.consent_notification'),
            t('shift.consent_who'),
            t('shift.consent_stops'),
          ] as const
        ).map((line) => (
          <View key={line} style={styles.row}>
            <Text aria-hidden>•</Text>
            <Text style={styles.grow}>{line}</Text>
          </View>
        ))}
      </Card>
      <Notice>{t('shift.tracking_note')}</Notice>
      {problem ? (
        <Text tone="danger" role="alert">
          {problem}
        </Text>
      ) : null}

      {step.name === 'consent' || step.name === 'locating' ? (
        <Button
          variant="primary"
          icon={step.name === 'locating' ? Crosshair : Check}
          label={t('shift.accept')}
          busy={step.name === 'locating'}
          onPress={() => void locate()}
        />
      ) : null}

      {step.name === 'selfie' ? (
        <View style={styles.stack}>
          <Text>{t('shift.selfie_needed')}</Text>
          <Button
            variant="primary"
            icon={Camera}
            label={t('shift.take_selfie')}
            onPress={() => {
              waitingForSelfie.current = true;
              router.push({
                pathname: '/camera',
                params: { kind: 'selfie', request: SELFIE_REQUEST },
              });
            }}
          />
        </View>
      ) : null}

      {step.name === 'odometer' && settings && settings.odometer !== 'off' ? (
        <OdometerStep
          setting={settings.odometer}
          request={ODOMETER_REQUEST}
          action={t('shift.odometer_continue')}
          onDone={(odometer) =>
            setStep(after('odometer', { ...step, ...(odometer ? { odometer } : {}) }))
          }
        />
      ) : null}

      {step.name === 'background' || step.name === 'saving' ? (
        <Card style={styles.stack}>
          <Text variant="headingMd">{t('shift.background_title')}</Text>
          <Text>{t('shift.background_body')}</Text>
          <Button
            variant="primary"
            icon={MapPin}
            label={t('shift.punch_in')}
            busy={step.name === 'saving'}
            onPress={() => (step.name === 'background' ? void start(step) : undefined)}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
  row: { flexDirection: 'row', gap: spacing.space2 },
  grow: { flex: 1 },
});
