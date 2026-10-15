import type { SyncPlanItem } from '@kshetra/shared';
import { todayIn } from '@kshetra/shared';
import { ListGroup, ListRow, Text } from '@kshetra/ui-mobile';
import { router } from 'expo-router';
import { CalendarCheck, CalendarClock, CalendarX, Hourglass } from 'lucide-react-native';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { useOutboxItems } from '../sync';

const ICONS = {
  planned: CalendarClock,
  visited: CalendarClock,
  completed: CalendarCheck,
  missed: CalendarX,
  cancelled: CalendarX,
} as const;

/** Today's plan items the phone holds, and those planned on the phone that wait to be sent. */
export function useTodayPlan(): {
  items: SyncPlanItem[];
  waiting: { id: string; accountId: string }[];
} {
  const config = useConfig();
  const rows = useLocalRows('plan_items') ?? [];
  const queued = useOutboxItems();
  const today = todayIn(config.data?.bundle.settings.timezone ?? 'Asia/Kolkata');
  return {
    items: rows
      .filter((item) => item.date === today && item.status !== 'cancelled')
      .sort((a, b) => a.id.localeCompare(b.id)),
    waiting: queued.flatMap((item) => {
      const payload = item.payload as { accountId?: string; date?: string };
      return item.kind === 'plan_item.create' && payload.date === today && payload.accountId
        ? [{ id: item.id, accountId: payload.accountId }]
        : [];
    }),
  };
}

/**
 * Today's plan on Home (spec 8.1, M8): the visits planned for today with their statuses, each
 * opening its account to check in there, and those the person planned on the phone that are
 * still on their way to the server.
 */
export function TodayPlan() {
  const { t } = useLanguage();
  const config = useConfig();
  const accounts = useLocalRows('accounts') ?? [];
  const { items, waiting } = useTodayPlan();
  const permissions = new Set<string>(config.data?.bundle.access.permissions ?? []);
  if (!permissions.has('visit.use')) return null;
  const name = (accountId: string) =>
    accounts.find((account) => account.id === accountId)?.name ?? '—';
  const open = (accountId: string) =>
    router.push({ pathname: '/accounts/[id]', params: { id: accountId } });
  return (
    <ListGroup title={t('today.title', { count: items.length + waiting.length })}>
      {items.length === 0 && waiting.length === 0 ? (
        <Text tone="muted">{t('today.empty')}</Text>
      ) : null}
      {items.map((item) => (
        <ListRow
          key={item.id}
          icon={ICONS[item.status]}
          tone={item.status === 'missed' ? 'danger' : 'default'}
          label={name(item.accountId)}
          detail={[t(`plan.status_${item.status}`), item.purpose].filter(Boolean).join(' · ')}
          onPress={() => open(item.accountId)}
        />
      ))}
      {waiting.map((item) => (
        <ListRow
          key={item.id}
          icon={Hourglass}
          label={name(item.accountId)}
          detail={t('today.waiting')}
          onPress={() => open(item.accountId)}
        />
      ))}
    </ListGroup>
  );
}
