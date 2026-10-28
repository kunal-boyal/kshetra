import { size, spacing } from '@thelamp/design-tokens';
import { formatDay } from '@thelamp/i18n';
import { timeIn, todayIn } from '@thelamp/shared';
import {
  Avatar,
  Button,
  Card,
  type Hue,
  IconButton,
  IconChip,
  Screen,
  SyncBanner,
  Text,
} from '@thelamp/ui-mobile';
import { type Href, router } from 'expo-router';
import {
  Bell,
  CalendarPlus,
  CircleAlert,
  ClipboardList,
  CloudUpload,
  type LucideIcon,
  MapPin,
  Receipt,
  RotateCw,
} from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useConfig, useMe } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useUnread } from '../notifications';
import { useSyncStatus } from '../sync';
import { Announcements } from './announcements';
import { MonthGlance } from './my-month';
import { ShiftSection, useShift } from './shift';
import { TodayPlan, useTodayPlan } from './today-plan';
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

/** The greeting for the hour on the tenant's clock, as the web's Home says it. */
export function greetingKey(timeZone: string, now?: Date) {
  const hour = Number(timeIn(timeZone, now).slice(0, 2));
  if (hour < 12) return 'home.greeting_morning' as const;
  if (hour < 17) return 'home.greeting_afternoon' as const;
  return 'home.greeting_evening' as const;
}

interface Start {
  key: string;
  label: string;
  icon: LucideIcon;
  hue: Hue;
  to: Href;
}

/**
 * Things to start from Home (the prototype's "Start something"), as tinted tiles two across:
 * each shows only with its permission and its module switched on.
 */
export function StartTiles() {
  const { t } = useLanguage();
  const bundle = useConfig().data?.bundle;
  const permissions = new Set<string>(bundle?.access.permissions ?? []);
  const off = new Set<string>(bundle?.settings.modulesOff ?? []);
  const starts: Start[] = [
    ...(permissions.has('visit.use') && permissions.has('account.view')
      ? [
          {
            key: 'visit',
            label: t('home.start_visit'),
            icon: MapPin,
            hue: 'mint' as const,
            to: '/accounts' as const,
          },
        ]
      : []),
    ...(permissions.has('submission.create')
      ? [
          {
            key: 'form',
            label: t('home.start_form'),
            icon: ClipboardList,
            hue: 'sky' as const,
            to: '/forms' as const,
          },
        ]
      : []),
    ...(!off.has('leave_attendance') && permissions.has('leave.request')
      ? [
          {
            key: 'leave',
            label: t('home.start_leave'),
            icon: CalendarPlus,
            hue: 'lilac' as const,
            to: '/leave/new' as const,
          },
        ]
      : []),
    ...(!off.has('expenses') && permissions.has('expense.claim')
      ? [
          {
            key: 'claim',
            label: t('home.start_claim'),
            icon: Receipt,
            hue: 'butter' as const,
            to: '/expenses/new' as const,
          },
        ]
      : []),
  ];
  if (starts.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text variant="headingMd" role="heading">
        {t('home.start')}
      </Text>
      <View style={styles.tiles}>
        {starts.map((start) => (
          <Pressable
            key={start.key}
            role="button"
            aria-label={start.label}
            onPress={() => router.push(start.to)}
            style={styles.tile}
          >
            {({ pressed }) => (
              <Card tint={start.hue} style={[styles.tileCard, pressed && styles.pressed]}>
                <IconChip icon={start.icon} hue={start.hue} />
                <Text variant="labelMd" weight={600} style={styles.grow}>
                  {start.label}
                </Text>
              </Card>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * Home (spec 8.1, decision D104, the prototype's AppHome): the person with a greeting for the hour,
 * the date and the day's route, and the inbox with its count; what waits to upload and the
 * vendor's announcements; the shift with its time, distance and visits; the visit in progress;
 * today's plan with the next stop; things to start; and My month at a glance.
 */
export function HomeScreen() {
  const { t, locale } = useLanguage();
  const me = useMe();
  const config = useConfig();
  const unread = useUnread().data ?? 0;
  const shift = useShift();
  const { items } = useTodayPlan();
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  const route = items.find((item) => item.routeName)?.routeName;
  const from = shift.state?.lastFix ?? null;

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        {me.data ? <Avatar name={me.data.name} id={me.data.userId} /> : null}
        <View style={styles.grow}>
          {me.data ? (
            <Text variant="headingMd" role="heading">
              {t(greetingKey(timeZone), { name: firstName(me.data.name) })}
            </Text>
          ) : null}
          <Text variant="bodySm" tone="muted">
            {[formatDay(todayIn(timeZone), { locale }), route].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <IconButton
          icon={Bell}
          label={t('notifications.title')}
          count={unread}
          onPress={() => router.push('/notifications')}
        />
      </View>
      <Banner />
      <Announcements />
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
      <ShiftSection />
      <VisitNow />
      <TodayPlan from={from} />
      <StartTiles />
      <MonthGlance />
    </Screen>
  );
}

/** The first of a person's names, as a greeting uses it. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  grow: { flex: 1, minWidth: 0 },
  section: { gap: spacing.space2 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
  // Two across: each tile takes half the row less half the gap.
  tile: { flexBasis: '47%', flexGrow: 1 },
  tileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    padding: spacing.space3,
    minHeight: size.touchMin + spacing.space4,
  },
  pressed: { opacity: 0.85 },
});
