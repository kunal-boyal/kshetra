import { spacing } from '@thelamp/design-tokens';
import { Button, Screen, SyncBanner, Text } from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { Bell, BellDot, CircleAlert, CloudUpload, RotateCw } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useConfig, useMe } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useUnread } from '../notifications';
import { useSyncStatus } from '../sync';
import { ShiftSection } from './shift';
import { MyMonth } from './my-month';
import { TodayPlan } from './today-plan';
import { VisitNow } from './visit';

/**
 * What is still on the phone (components/SyncBanner): red once something was refused, else amber
 * while items wait, and nothing when all is uploaded. It opens the upload queue.
 */
function Banner() {
  const { t } = useLanguage();
  const status = useSyncStatus();
  if (!status) return null;
  const { queued, parked } = status.counts;
  const open = () => router.push('/uploads');
  if (parked > 0) {
    return (
      <SyncBanner
        tone="danger"
        icon={CircleAlert}
        message={t('sync.refused', { count: parked })}
        action={t('sync.view')}
        onPress={open}
      />
    );
  }
  if (queued === 0) return null;
  return (
    <SyncBanner
      tone="pending"
      icon={CloudUpload}
      message={t(status.offline ? 'sync.offline' : 'sync.waiting', { count: queued })}
      action={t('sync.view')}
      onPress={open}
    />
  );
}

/** The inbox, with how many are unread (M16, decision D59); read online. */
function InboxButton() {
  const { t } = useLanguage();
  const unread = useUnread().data ?? 0;
  return (
    <Button
      variant="ghost"
      icon={unread > 0 ? BellDot : Bell}
      label={unread > 0 ? t('notifications.open', { count: unread }) : t('notifications.title')}
      onPress={() => router.push('/notifications')}
    />
  );
}

/**
 * Home (spec 8.1): the sync banner, the tenant's name, a greeting, the shift card, the visit the
 * person is in, today's plan and My month, with the inbox beside the tenant's name.
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
      <Banner />
      <View style={styles.top}>
        <Text variant="labelSm" tone="muted" style={styles.grow}>
          {session?.tenant.name}
        </Text>
        <InboxButton />
      </View>
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
      <ShiftSection />
      <VisitNow />
      <TodayPlan />
      <MyMonth />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
  greeting: { gap: spacing.space1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  grow: { flex: 1 },
});
