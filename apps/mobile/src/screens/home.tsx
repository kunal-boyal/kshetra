import { spacing } from '@kshetra/design-tokens';
import { Button, EmptyState, Screen, Text } from '@kshetra/ui-mobile';
import { LayoutDashboard, RotateCw } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useConfig, useMe } from '../data';
import { errorMessage, useLanguage } from '../i18n';

/**
 * Home (spec 8.1): the tenant's name and a greeting. The sync banner, shift card, plan and
 * "My month" tiles arrive with their modules in phase 1.
 */
export function HomeScreen() {
  const { session } = useApp();
  const { t, locale } = useLanguage();
  const me = useMe();
  const config = useConfig();

  const designation = config.data?.bundle.designations.find(
    (entry) => entry.key === me.data?.designation,
  );
  return (
    <Screen edges={['top', 'left', 'right']}>
      <Text variant="labelSm" tone="muted">
        {session?.tenant.name}
      </Text>
      {me.isPending ? <Text tone="muted">{t('common.loading')}</Text> : null}
      {me.isError ? (
        <View style={styles.stack}>
          <Text tone="danger" weight={500} role="alert">
            {errorMessage(me.error, t)}
          </Text>
          <Button
            variant="secondary"
            icon={RotateCw}
            label={t('common.retry')}
            onPress={() => {
              void me.refetch();
              void config.refetch();
            }}
          />
        </View>
      ) : null}
      {me.data ? (
        <View style={styles.greeting}>
          <Text variant="display" role="heading">
            {t('home.greeting', { name: me.data.name })}
          </Text>
          {designation && session ? (
            <Text tone="muted">
              {t('home.where', {
                designation: designation.name[locale].one,
                tenant: session.tenant.name,
              })}
            </Text>
          ) : null}
        </View>
      ) : null}
      <EmptyState icon={LayoutDashboard} title={t('home.empty_title')}>
        {t('home.empty_body')}
      </EmptyState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
  greeting: { gap: spacing.space1 },
});
