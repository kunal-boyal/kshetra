import { spacing } from '@kshetra/design-tokens';
import { Button, Screen, Text, useTheme } from '@kshetra/ui-mobile';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { ArrowLeft, ScanLine } from 'lucide-react-native';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { addResult } from '../capture-results';
import { useLanguage } from '../i18n';

/**
 * The scanner (spec 5.6 barcode fields): the camera reads the first code it sees, hands it to
 * the screen that asked, and goes back. A code can also be typed on the form itself.
 */
export function ScanScreen({ request }: { request: string }) {
  const { t } = useLanguage();
  const theme = useTheme();
  const [permission, ask] = useCameraPermissions();
  const read = useRef(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/forms'));

  if (!permission) return <Screen>{null}</Screen>;
  if (!permission.granted) {
    return (
      <Screen>
        <Button variant="ghost" icon={ArrowLeft} label={t('common.back')} onPress={back} />
        <Text variant="headingXl" role="heading">
          {t('scan.title')}
        </Text>
        <Text tone="muted">
          {t(permission.canAskAgain ? 'camera.permission' : 'camera.permission_settings')}
        </Text>
        {permission.canAskAgain ? (
          <Button
            variant="primary"
            icon={ScanLine}
            label={t('camera.allow')}
            onPress={() => void ask()}
          />
        ) : null}
      </Screen>
    );
  }
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.surfaceInverse }]}>
      <CameraView
        style={styles.fill}
        facing="back"
        accessibilityLabel={t('scan.live')}
        onBarcodeScanned={(result) => {
          if (read.current || !result.data) return;
          read.current = true;
          addResult(request, result.data);
          back();
        }}
      />
      <View style={[styles.bar, { backgroundColor: theme.colors.surface }]}>
        <Text>{t('scan.hint')}</Text>
        <Button variant="ghost" icon={ArrowLeft} label={t('common.back')} onPress={back} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { padding: spacing.space4, gap: spacing.space2 },
});
