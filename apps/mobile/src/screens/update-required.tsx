import { spacing } from '@thelamp/design-tokens';
import { Button, IconChip, Screen, Text } from '@thelamp/ui-mobile';
import { Download, Store } from 'lucide-react-native';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { useLanguage } from '../i18n';

/**
 * The store page where this build's next version is found, as the build carries it
 * (`EXPO_PUBLIC_PLAY_STORE_URL`, `EXPO_PUBLIC_APP_STORE_URL`); none until the app has a listing.
 */
export function storeUrl(os: string = Platform.OS): string | undefined {
  const url =
    os === 'android'
      ? process.env.EXPO_PUBLIC_PLAY_STORE_URL
      : os === 'ios'
        ? process.env.EXPO_PUBLIC_APP_STORE_URL
        : undefined;
  return url || undefined;
}

/**
 * The blocking update screen (M1, rule 8): the API no longer supports this version, so nothing
 * else opens. It opens the store page the build names; a build without one tells the person to
 * ask their admin for the new version.
 */
export function UpdateRequiredScreen() {
  const { t } = useLanguage();
  const store = storeUrl();
  return (
    <Screen centred>
      <View style={styles.body}>
        <IconChip icon={Download} size="xl" />
        <Text variant="headingXl" role="heading" style={styles.centre}>
          {t('app.update_title')}
        </Text>
        <Text tone="muted" style={styles.centre}>
          {t('app.update_body')}
        </Text>
        {store ? (
          <Button
            variant="primary"
            icon={Store}
            label={t('app.update_action')}
            onPress={() => void Linking.openURL(store)}
          />
        ) : (
          <Text style={styles.centre}>{t('app.update_ask_admin')}</Text>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: spacing.space4 },
  centre: { textAlign: 'center' },
});
