import { spacing } from '@thelamp/design-tokens';
import { punchFixIssue, type PunchOdometer } from '@thelamp/shared';
import { Button, Screen, Text } from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { currentFix } from '../location';
import { useSync } from '../sync';
import { punchOut } from '../tracking';
import { OdometerStep } from './odometer-step';

/**
 * Punching out where the tenant asks for the odometer (decision D99): the closing reading and its
 * photo, then a fresh fix, saved on the phone and sent when there is signal. Without odometer
 * readings, Home's card punches out by itself.
 */
export function PunchOutScreen() {
  const { client } = useApp();
  const { t } = useLanguage();
  const sync = useSync();
  const settings = useConfig().data?.bundle.settings;
  const [opening, setOpening] = useState<string | null>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // The opening reading, which the closing one may not fall below.
  useEffect(() => {
    const owner = client.owner;
    if (!sync || !owner) return;
    let live = true;
    void (async () => {
      const state = await sync.tracking.current(owner);
      const kept = state ? await sync.tracking.odometer(owner, state.shiftId) : null;
      if (live) setOpening(kept?.open ?? null);
    })();
    return () => {
      live = false;
    };
  }, [sync, client]);

  async function end(odometer: PunchOdometer | undefined) {
    if (!sync || !client.owner) return;
    setBusy(true);
    setProblem(undefined);
    const fix = await currentFix();
    if (fix.status !== 'ready') {
      setProblem(t(fix.status === 'denied' ? 'shift.fix_denied' : 'shift.fix_unavailable'));
      setBusy(false);
      return;
    }
    const issue = punchFixIssue(fix.fix);
    if (issue) {
      setProblem(t(issue === 'GPS_MOCKED' ? 'shift.fix_mocked' : 'shift.fix_vague'));
      setBusy(false);
      return;
    }
    try {
      await punchOut(sync, client.owner, fix.fix, odometer);
      await sync.runner.refresh();
      void sync.runner.sync();
      router.replace('/');
    } catch {
      setProblem(t('shift.not_saved'));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Button variant="ghost" icon={ArrowLeft} label={t('common.back')} onPress={back} />
      <Text variant="headingXl" role="heading">
        {t('shift.punch_out_title')}
      </Text>
      <View style={styles.stack}>
        {settings && settings.odometer !== 'off' && opening !== undefined ? (
          <OdometerStep
            setting={settings.odometer}
            opening={opening}
            request="punch-out-odometer"
            action={t('shift.punch_out')}
            busy={busy}
            onDone={(odometer) => void end(odometer)}
          />
        ) : null}
        {problem ? (
          <Text tone="danger" role="alert">
            {problem}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ stack: { gap: spacing.space3 } });
