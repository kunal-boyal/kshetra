import { spacing } from '@thelamp/design-tokens';
import type { PhotoKind } from '@thelamp/shared';
import { Button, Screen, Text, useTheme } from '@thelamp/ui-mobile';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { ArrowLeft, Camera, Check, RotateCcw } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../app-state';
import { addResult } from '../capture-results';
import { useLanguage } from '../i18n';
import { currentFix, type Fix } from '../location';
import { preparePhoto, queuePhoto } from '../photos';
import { useSync } from '../sync';

interface Shot {
  uri: string;
  width: number;
  height: number;
  takenAt: string;
}

/**
 * The camera (spec 8.1): a live picture, a shutter, then retake or use. A used photo is resized,
 * kept in the app's storage with its time and the latest fix, and queued to upload; no gallery
 * here. A selfie uses the front camera.
 */
export function CameraScreen({ kind, request }: { kind: PhotoKind; request: string }) {
  const { client } = useApp();
  const { t } = useLanguage();
  const theme = useTheme();
  const sync = useSync();
  const [permission, ask] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const fix = useRef<Fix | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string>();

  // Where the phone is, taken while the person frames the picture (BR-32 checks its age later).
  useEffect(() => {
    let live = true;
    void currentFix().then((state) => {
      if (live && state.status === 'ready') fix.current = state.fix;
    });
    return () => {
      live = false;
    };
  }, []);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  async function shoot() {
    setError(undefined);
    try {
      const picture = await camera.current?.takePictureAsync({ quality: 1, skipProcessing: false });
      if (!picture) return;
      setShot({ ...picture, takenAt: new Date().toISOString() });
    } catch {
      setError(t('camera.failed'));
    }
  }

  async function use() {
    if (!shot || !sync || !client.owner) return;
    setBusy(true);
    try {
      const prepared = await preparePhoto(shot);
      await queuePhoto(sync, client.owner, {
        ...prepared,
        kind,
        capturedAt: shot.takenAt,
        source: 'camera',
        fix: fix.current,
      });
      addResult(request, prepared.id);
      back();
    } catch {
      setError(t('camera.not_saved'));
      setBusy(false);
    }
  }

  if (!permission) return <Screen>{null}</Screen>;
  if (!permission.granted) {
    return (
      <Screen>
        <Button variant="ghost" icon={ArrowLeft} label={t('common.back')} onPress={back} />
        <Text variant="headingXl" role="heading">
          {t('camera.title')}
        </Text>
        <Text tone="muted">
          {t(permission.canAskAgain ? 'camera.permission' : 'camera.permission_settings')}
        </Text>
        {permission.canAskAgain ? (
          <Button
            variant="primary"
            icon={Camera}
            label={t('camera.allow')}
            onPress={() => void ask()}
          />
        ) : null}
      </Screen>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.surfaceInverse }]}>
      {shot ? (
        <Image
          source={{ uri: shot.uri }}
          style={styles.fill}
          resizeMode="contain"
          accessibilityLabel={t('camera.preview')}
        />
      ) : (
        <CameraView
          ref={camera}
          style={styles.fill}
          facing={kind === 'selfie' ? 'front' : 'back'}
          accessibilityLabel={t('camera.live')}
        />
      )}
      {/* Drawn edge to edge, so the bar keeps clear of Android's navigation buttons itself. */}
      <View
        style={[
          styles.bar,
          {
            backgroundColor: theme.colors.surface,
            paddingBottom: spacing.space4 + insets.bottom,
          },
        ]}
      >
        {error ? (
          <Text tone="danger" role="alert">
            {error}
          </Text>
        ) : null}
        {shot ? (
          <View style={styles.actions}>
            <Button
              variant="secondary"
              icon={RotateCcw}
              label={t('camera.retake')}
              disabled={busy}
              onPress={() => setShot(null)}
            />
            <Button
              variant="primary"
              icon={Check}
              label={t('camera.use')}
              busy={busy}
              onPress={() => void use()}
            />
          </View>
        ) : (
          <View style={styles.actions}>
            <Button variant="ghost" icon={ArrowLeft} label={t('common.back')} onPress={back} />
            <Button
              variant="primary"
              icon={Camera}
              label={t('camera.shutter')}
              onPress={() => void shoot()}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { padding: spacing.space4, gap: spacing.space2 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.space2 },
});
