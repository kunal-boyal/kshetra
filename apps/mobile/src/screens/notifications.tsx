import { spacing } from '@thelamp/design-tokens';
import { formatDateTime, notificationMessage } from '@thelamp/i18n';
import type { NotificationCategoryKey, NotificationResult } from '@thelamp/shared';
import {
  Button,
  CheckGroup,
  EmptyState,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  Text,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, Bell, BellDot, CheckCheck, RotateCw, Save } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useInbox, useMarkRead, useNotificationPrefs, useSavePrefs } from '../notifications';
import { openLink } from '../push';

/**
 * The inbox on the phone (M16, decision D59): newest first, in the reader's language. Opening one
 * marks it read and goes where it leads; below, what the person hears about. Approvals and
 * tracking alerts can't be muted. Read online.
 */
export function NotificationsScreen() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const inbox = useInbox();
  const prefs = useNotificationPrefs();
  const markRead = useMarkRead();
  const savePrefs = useSavePrefs();
  const [edited, setEdited] = useState<NotificationCategoryKey[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = inbox.data?.pages[0]?.unread ?? 0;
  const mutable = prefs.data?.categories.filter((entry) => entry.mutable) ?? [];
  // What the person ticks, or else what they saved: a ticked category is heard.
  const heard = edited ?? mutable.filter((entry) => !entry.muted).map((entry) => entry.category);

  async function open(item: NotificationResult) {
    setFailure(undefined);
    try {
      if (!item.readAt) await markRead({ ids: [item.id] });
      openLink(item.link);
    } catch (caught) {
      setFailure(caught);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setFailure(undefined);
    try {
      await savePrefs(
        mutable.map((entry) => entry.category).filter((category) => !heard.includes(category)),
      );
      setEdited(null);
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <Text variant="headingXl" role="heading">
        {t('notifications.title')}
      </Text>
      {failure ? (
        <Text tone="danger" role="alert">
          {errorMessage(failure, t)}
        </Text>
      ) : null}
      {inbox.isError ? (
        <View style={styles.stack}>
          <Text tone="danger" role="alert">
            {errorMessage(inbox.error, t)}
          </Text>
          <Button
            variant="secondary"
            icon={RotateCw}
            label={t('common.retry')}
            onPress={() => void inbox.refetch()}
          />
        </View>
      ) : !inbox.data ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : items.length === 0 ? (
        <EmptyState icon={Bell} title={t('notifications.empty_title')}>
          {t('notifications.empty_body')}
        </EmptyState>
      ) : (
        <View style={styles.stack}>
          {unread > 0 ? (
            <Button
              variant="tonal"
              icon={CheckCheck}
              label={t('notifications.read_all')}
              onPress={() => void markRead({ all: true }).catch(setFailure)}
            />
          ) : null}
          <ListGroup title={t('notifications.inbox', { count: unread })}>
            {items.map((item) => {
              const message = notificationMessage(item.event, item.values, locale);
              return (
                <ListRow
                  key={item.id}
                  icon={item.readAt ? Bell : BellDot}
                  label={t(message.title, message.params)}
                  detail={[
                    t(message.body, message.params),
                    formatDateTime(item.createdAt, { locale, timeZone }),
                    item.readAt ? null : t('notifications.unread'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  onPress={() => void open(item)}
                />
              );
            })}
          </ListGroup>
          {inbox.hasNextPage ? (
            <Button
              variant="secondary"
              label={t('common.load_more')}
              busy={inbox.isFetchingNextPage}
              onPress={() => void inbox.fetchNextPage()}
            />
          ) : null}
        </View>
      )}

      {prefs.data ? (
        <View style={styles.stack}>
          <CheckGroup
            title={t('notifications.prefs_title')}
            choices={mutable.map((entry) => ({
              value: entry.category,
              label: t(`notify.category_${entry.category}`),
            }))}
            value={heard}
            onChange={(next) => {
              setSaved(false);
              setEdited(next);
            }}
          />
          <Notice>{t('notifications.prefs_intro')}</Notice>
          {saved ? <Text role="status">{t('notifications.prefs_saved')}</Text> : null}
          <Button
            variant="primary"
            icon={Save}
            label={t('notifications.prefs_save')}
            busy={saving}
            disabled={edited === null}
            onPress={() => void save()}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ stack: { gap: spacing.space3 } });
