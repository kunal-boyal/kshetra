import { spacing } from '@thelamp/design-tokens';
import { formatNumber } from '@thelamp/i18n';
import { odometerIssue, type OdometerSetting, type PunchOdometer } from '@thelamp/shared';
import { Button, Card, Text, TextField } from '@thelamp/ui-mobile';
import { router, useFocusEffect } from 'expo-router';
import { Camera, Check } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { takeResults } from '../capture-results';
import { useLanguage } from '../i18n';

/** Kilometres, to a tenth, as the server takes them. */
const READING = /^(?:0|[1-9]\d{0,8})(?:\.\d)?$/;

/**
 * The odometer at a punch (decision D99): the reading, typed, and a live photo of it. Where the
 * tenant only asks, the person may skip both; a closing reading below the opening one is refused
 * here as the server would.
 */
export function OdometerStep({
  setting,
  opening,
  request,
  action,
  busy,
  onDone,
}: {
  setting: Exclude<OdometerSetting, 'off'>;
  /** The shift's opening reading, at punch-out. */
  opening?: string | null;
  /** Names the camera's results for this step. */
  request: string;
  /** What finishing the step does, such as "Continue" or "Punch out". */
  action: string;
  busy?: boolean;
  onDone: (odometer: PunchOdometer | undefined) => void;
}) {
  const { t, locale } = useLanguage();
  const [reading, setReading] = useState('');
  const [photoId, setPhotoId] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const waiting = useRef(false);

  // Back from the camera with the photo.
  useFocusEffect(
    useCallback(() => {
      if (!waiting.current) return;
      const taken = takeResults(request).at(-1);
      if (!taken) return;
      waiting.current = false;
      setPhotoId(taken);
    }, [request]),
  );

  function finish() {
    const typed = reading.replace(/,/g, '').trim();
    if (!typed && !photoId && setting === 'optional') {
      onDone(undefined);
      return;
    }
    if (!typed) return setProblem(t('shift.odometer_needs_reading'));
    if (!READING.test(typed)) return setProblem(t('shift.odometer_bad'));
    if (odometerIssue(setting, typed, opening) === 'below_opening') {
      return setProblem(
        t('shift.odometer_below', { opening: formatNumber(Number(opening), { locale }) }),
      );
    }
    if (!photoId) return setProblem(t('shift.odometer_needs_photo'));
    setProblem(undefined);
    onDone({ reading: typed, photoId });
  }

  return (
    <Card style={styles.stack}>
      <Text variant="headingMd" role="heading">
        {t('shift.odometer_title')}
      </Text>
      <Text tone="muted">
        {t(setting === 'required' ? 'shift.odometer_required' : 'shift.odometer_optional')}
      </Text>
      {opening ? (
        <Text>
          {t('shift.odometer_opening', { reading: formatNumber(Number(opening), { locale }) })}
        </Text>
      ) : null}
      <TextField
        label={t('shift.odometer_reading')}
        numeric
        keyboardType="decimal-pad"
        value={reading}
        onChangeText={(text) => {
          setProblem(undefined);
          setReading(text);
        }}
      />
      <View style={styles.row}>
        <Button
          variant="secondary"
          icon={photoId ? Check : Camera}
          label={t(photoId ? 'shift.odometer_retake' : 'shift.odometer_photo')}
          onPress={() => {
            waiting.current = true;
            router.push({ pathname: '/camera', params: { kind: 'odometer', request } });
          }}
        />
        {photoId ? <Text tone="accent">{t('shift.odometer_photo_taken')}</Text> : null}
      </View>
      {problem ? (
        <Text tone="danger" role="alert">
          {problem}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Button variant="primary" label={action} busy={busy} onPress={finish} />
        {setting === 'optional' && !reading && !photoId ? (
          <Button
            variant="ghost"
            label={t('shift.odometer_skip')}
            onPress={() => onDone(undefined)}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.space2 },
});
