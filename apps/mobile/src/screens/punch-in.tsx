import { spacing } from '@thelamp/design-tokens';
import { punchFixIssue } from '@thelamp/shared';
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

const SELFIE_REQUEST = 'punch-in-selfie';

type Step =
  | { name: 'consent' }
  | { name: 'locating' }
  | { name: 'selfie'; fix: Fix }
  | { name: 'background'; fix: Fix; selfieMediaId?: string }
  | { name: 'saving' };

/**
 * Punching in (M5): the consent sheet in the person's language, a fresh fix of 250 m or better
 * that isn't mocked, a selfie when the tenant asks, and the background permission, explained in
 * the app before the system asks (spec 12.1). The shift is saved on the phone first and sent when
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
    setStep(
      settings?.attendanceSelfie
        ? { name: 'selfie', fix: state.fix }
        : { name: 'background', fix: state.fix },
    );
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
          ? { name: 'background', fix: current.fix, selfieMediaId: mediaId }
          : current,
      );
    }, []),
  );

  async function start(fix: Fix, selfieMediaId?: string) {
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
        ...(selfieMediaId ? { selfieMediaId } : {}),
      });
      await sync.runner.refresh();
      void sync.runner.sync();
    } catch {
      setProblem(t('shift.not_saved'));
      setStep({ name: 'background', fix, ...(selfieMediaId ? { selfieMediaId } : {}) });
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

      {step.name === 'background' || step.name === 'saving' ? (
        <Card style={styles.stack}>
          <Text variant="headingMd">{t('shift.background_title')}</Text>
          <Text>{t('shift.background_body')}</Text>
          <Button
            variant="primary"
            icon={MapPin}
            label={t('shift.punch_in')}
            busy={step.name === 'saving'}
            onPress={() =>
              step.name === 'background' ? void start(step.fix, step.selfieMediaId) : undefined
            }
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
