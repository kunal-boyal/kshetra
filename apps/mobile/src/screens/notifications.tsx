import { spacing } from '@thelamp/design-tokens';
import { formatDateTime, formatTime, notificationMessage } from '@thelamp/i18n';
import { type NotificationCategoryKey, type NotificationResult, todayIn } from '@thelamp/shared';
import {
  AppBar,
  Button,
  CheckGroup,
  EmptyState,
  type Hue,
  IconChip,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  Text,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import {
  Bell,
  CalendarCheck,
  CheckCheck,
  ClipboardCheck,
  LifeBuoy,
  type LucideIcon,
  MapPin,
  MessageCircle,
  Moon,
  RotateCw,
  Save,
  Target,
  Upload,
} from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import {
  useAnswerWhatsApp,
  useInbox,
  useMarkRead,
  useNotificationPrefs,
  useSavePrefs,
  useWhatsAppConsent,
} from '../notifications';
import { openLink } from '../push';
import { dayOf, nowMs, when } from '../when';

/** Each category's chip on a row (decision D104). */
const CATEGORY: Record<NotificationResult['category'], { icon: LucideIcon; hue: Hue }> = {
  plan: { icon: CalendarCheck, hue: 'sage' },
  approvals: { icon: CheckCheck, hue: 'mint' },
  review: { icon: ClipboardCheck, hue: 'peach' },
  targets: { icon: Target, hue: 'butter' },
  tracking: { icon: MapPin, hue: 'rose' },
  imports: { icon: Upload, hue: 'sky' },
  support: { icon: LifeBuoy, hue: 'lilac' },
};

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
  const settings = config.data?.bundle.settings;
  const timeZone = settings?.timezone ?? 'Asia/Kolkata';
  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];
  const now = nowMs();
  const today = todayIn(timeZone, new Date(now));
  const groups = [
    {
      key: 'today',
      title: t('notifications.today'),
      items: items.filter((item) => dayOf(item.createdAt, timeZone) === today),
    },
    {
      key: 'earlier',
      title: t('notifications.earlier'),
      items: items.filter((item) => dayOf(item.createdAt, timeZone) !== today),
    },
  ].filter((group) => group.items.length > 0);
  // Quiet hours are times of day on the tenant's clock; shown as the phone writes times.
  const clock = (time: string) =>
    formatTime(new Date(`2000-01-01T${time}:00Z`), { locale, timeZone: 'UTC' });
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
      <AppBar
        title={t('notifications.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        backLabel={t('common.back')}
        action={
          unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              label={t('notifications.read_all')}
              onPress={() => void markRead({ all: true }).catch(setFailure)}
            />
          ) : undefined
        }
      />
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
          {groups.map((group) => (
            <ListGroup key={group.key} title={group.title}>
              {group.items.map((item) => {
                const message = notificationMessage(item.event, item.values, locale);
                const look = CATEGORY[item.category];
                return (
                  <ListRow
                    key={item.id}
                    lead={<IconChip icon={look.icon} hue={look.hue} />}
                    label={t(message.title, message.params)}
                    detail={t(message.body, message.params)}
                    meta={when(item.createdAt, { t, locale, timeZone, now })}
                    unread={!item.readAt}
                    unreadLabel={t('notifications.unread')}
                    highlight={!item.readAt}
                    onPress={() => void open(item)}
                  />
                );
              })}
            </ListGroup>
          ))}
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

      {settings ? (
        <Notice icon={Moon}>
          {t('notifications.quiet', {
            start: clock(settings.quietHoursStart),
            end: clock(settings.quietHoursEnd),
          })}
        </Notice>
      ) : null}

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

      <WhatsAppConsent />
    </Screen>
  );
}

/**
 * WhatsApp messages (spec 13.4, decision D85): the text people agree to, whether and when they did,
 * and agreeing or stopping. An agreement to an earlier text no longer counts.
 */
function WhatsAppConsent() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const consent = useWhatsAppConsent();
  const answer = useAnswerWhatsApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const data = consent.data;
  if (!data) return null;
  const current = data.optedIn && data.version === data.currentVersion;
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';

  async function press() {
    if (!data) return;
    setBusy(true);
    setError(undefined);
    try {
      await answer(!current, data.currentVersion);
    } catch (caught) {
      setError(errorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ListGroup title={t('whatsapp.title')}>
      <View style={styles.stack}>
        <Text>{t('whatsapp.consent')}</Text>
        {data.available ? null : <Notice>{t('whatsapp.unavailable')}</Notice>}
        <Text tone="muted" role="status">
          {current && data.at
            ? t('whatsapp.agreed', { date: formatDateTime(data.at, { locale, timeZone }) })
            : data.optedIn
              ? t('whatsapp.changed')
              : t('whatsapp.not_agreed')}
        </Text>
        {error ? (
          <Text tone="danger" role="alert">
            {error}
          </Text>
        ) : null}
        <Button
          variant="secondary"
          icon={MessageCircle}
          label={current ? t('whatsapp.stop') : t('whatsapp.agree')}
          busy={busy}
          onPress={() => void press()}
        />
      </View>
    </ListGroup>
  );
}

const styles = StyleSheet.create({ stack: { gap: spacing.space3 } });
