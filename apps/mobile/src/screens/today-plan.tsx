import { spacing } from '@thelamp/design-tokens';
import { formatNumber } from '@thelamp/i18n';
import type { GeoPoint, Locale, SyncPlanItem } from '@thelamp/shared';
import { distanceMeters, todayIn } from '@thelamp/shared';
import { Button, Card, ListRow, ProgressBar, SeqBadge, Text } from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { Map as MapIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { useOutboxItems } from '../sync';

/**
 * Today's plan items the phone holds, in route order (each account's place on its route, then
 * the rest), and those planned on the phone that wait to be sent.
 */
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
      .sort(
        (a, b) =>
          (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
          a.id.localeCompare(b.id),
      ),
    waiting: queued.flatMap((item) => {
      const payload = item.payload as { accountId?: string; date?: string };
      return item.kind === 'plan_item.create' && payload.date === today && payload.accountId
        ? [{ id: item.id, accountId: payload.accountId }]
        : [];
    }),
  };
}

/** How far the next stop is: metres under a kilometre, else kilometres to one place. */
function away(meters: number, locale: Locale, t: ReturnType<typeof useLanguage>['t']): string {
  return meters < 1000
    ? t('today.away_m', { distance: formatNumber(Math.round(meters / 10) * 10, { locale }) })
    : t('accounts.away_km', {
        distance: formatNumber(meters / 1000, { locale }, { maximumFractionDigits: 1 }),
      });
}

/**
 * Today's plan on Home (spec 8.1, M8, decision D104): how many of the day's stops are done, as a
 * count and a bar (done, and visited waiting for review), and the next stop in route order with
 * its type and, once the phone has a fix on duty, how far it is. The whole day is a tap away.
 */
export function TodayPlan({ from }: { from: GeoPoint | null }) {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const accounts = useLocalRows('accounts') ?? [];
  const { items, waiting } = useTodayPlan();
  const bundle = config.data?.bundle;
  const permissions = new Set<string>(bundle?.access.permissions ?? []);
  if (!permissions.has('visit.use')) return null;
  const total = items.length;
  const completed = items.filter((item) => item.status === 'completed').length;
  const visited = items.filter((item) => item.status === 'visited').length;
  const nextIndex = items.findIndex((item) => item.status === 'planned');
  const next = nextIndex < 0 ? undefined : items[nextIndex];
  const account = next && accounts.find((entry) => entry.id === next.accountId);
  const type = account && bundle?.accountTypes?.find((entry) => entry.key === account.type);
  const done = t('today.done_of', {
    done: formatNumber(completed + visited, { locale }),
    total: formatNumber(total, { locale }),
  });
  return (
    <Card style={styles.card} role="group" aria-label={t('today.card_title')}>
      <View style={styles.spread}>
        <Text variant="headingMd" role="heading" style={styles.grow}>
          {t('today.card_title')}
        </Text>
        {total > 0 ? (
          <Text variant="bodySm" tone="muted" style={styles.figures}>
            {done}
          </Text>
        ) : null}
      </View>
      {total === 0 ? <Text tone="muted">{t('today.empty')}</Text> : null}
      {total > 0 ? (
        <ProgressBar
          label={done}
          parts={[
            { value: completed / total, tone: 'done' },
            { value: visited / total, tone: 'pending' },
          ]}
        />
      ) : null}
      {next ? (
        <ListRow
          lead={<SeqBadge n={nextIndex + 1} />}
          label={account?.name ?? '—'}
          detail={[
            t('today.next'),
            type?.name[locale].one,
            account?.location && from
              ? away(distanceMeters(from, account.location), locale, t)
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          {...(next.purpose ? { meta: next.purpose } : {})}
          onPress={() =>
            router.push({ pathname: '/accounts/[id]', params: { id: next.accountId } })
          }
        />
      ) : total > 0 ? (
        <Text tone="muted">{t('today.all_done')}</Text>
      ) : null}
      {waiting.length > 0 ? (
        <Text variant="bodySm" tone="muted">
          {t('today.waiting_count', { count: waiting.length })}
        </Text>
      ) : null}
      {total > 0 ? (
        <View style={styles.start}>
          <Button
            variant="ghost"
            size="sm"
            icon={MapIcon}
            label={t('today.see_all')}
            onPress={() => router.push('/today-route')}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.space3 },
  spread: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  grow: { flex: 1 },
  figures: { fontVariant: ['tabular-nums'] },
  start: { alignItems: 'flex-start' },
});
