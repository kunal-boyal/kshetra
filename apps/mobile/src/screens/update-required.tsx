import { spacing } from '@thelamp/design-tokens';
import { Button, IconChip, Screen, Text } from '@thelamp/ui-mobile';
import Constants from 'expo-constants';
import { Download, Store } from 'lucide-react-native';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { useLanguage } from '../i18n';

/**
 * The blocking update screen (M1, rule 8): the API no longer supports this version, so nothing
 * else opens. On Android it opens the app's store page; iOS gets one once the app has an App
 * Store listing (decision D1).
 */
export function UpdateRequiredScreen() {
  const { t } = useLanguage();
  const androidPackage = Constants.expoConfig?.android?.package;
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
        {Platform.OS === 'android' && androidPackage ? (
          <Button
            variant="primary"
            icon={Store}
            label={t('app.update_action')}
            onPress={() => void Linking.openURL(`market://details?id=${androidPackage}`)}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: spacing.space4 },
  centre: { textAlign: 'center' },
});
