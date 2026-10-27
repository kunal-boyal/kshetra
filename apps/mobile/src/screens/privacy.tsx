import { spacing } from '@thelamp/design-tokens';
import { formatDate, PRIVACY_NOTICE, PRIVACY_NOTICE_DATE, privacyParagraph } from '@thelamp/i18n';
import { Button, ListGroup, ListRow, Screen, Text } from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, ExternalLink } from 'lucide-react-native';
import { Linking, StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { PRODUCT_NAME } from '../product';

/** The provider's privacy address, set per build; without it the notice points to the store page. */
const PRIVACY_EMAIL = process.env.EXPO_PUBLIC_PRIVACY_EMAIL || undefined;

/**
 * The privacy notice (spec 13.3, decision D100), the same sections the portal's /privacy page
 * shows, readable before signing in; signed in, the organisation's own policy is linked too.
 */
export function PrivacyScreen() {
  const { t, locale } = useLanguage();
  const { session } = useApp();
  const params = { product: PRODUCT_NAME, ...(PRIVACY_EMAIL ? { email: PRIVACY_EMAIL } : {}) };
  return (
    <Screen>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <Text variant="headingXl" role="heading">
        {t('privacy.title')}
      </Text>
      <Text tone="muted">
        {t('privacy.changed', { date: formatDate(PRIVACY_NOTICE_DATE, { locale }) })}
      </Text>
      {session ? <OrganisationPolicy /> : null}
      {PRIVACY_NOTICE.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text variant="headingMd" role="heading">
            {t(section.title)}
          </Text>
          {section.paragraphs.map((key) => (
            <Text key={key}>{t(privacyParagraph(key, PRIVACY_EMAIL), params)}</Text>
          ))}
        </View>
      ))}
    </Screen>
  );
}

/** The organisation's own policy, where its admin has given one in Settings › Organisation. */
function OrganisationPolicy() {
  const { t } = useLanguage();
  const url = useConfig().data?.bundle.settings.privacyPolicyUrl;
  if (!url) return null;
  return (
    <ListGroup>
      <ListRow
        icon={ExternalLink}
        label={t('privacy.organisation_policy')}
        onPress={() => void Linking.openURL(url)}
      />
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.space2 },
});
