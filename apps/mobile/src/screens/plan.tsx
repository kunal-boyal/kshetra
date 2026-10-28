import { radius, spacing } from '@thelamp/design-tokens';
import { formatDay, formatNumber } from '@thelamp/i18n';
import { type GeoPoint, pathLengthMeters, type SyncPlanItem, todayIn } from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  EmptyState,
  ListGroup,
  ListRow,
  Screen,
  SegmentedControl,
  SeqBadge,
  StatusBadge,
  Text,
  useTheme,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { Hourglass, MapPinPlus, Route } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { useFix } from '../location';
import { Line, PhoneMap, Spot, type SpotTone } from '../maps';
import { usePlanDay } from './today-plan';

const DAY_MS = 86_400_000;

/** A calendar date `days` from `date`. */
function dayFrom(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

type StopState = 'done' | 'review' | 'missed' | 'next' | 'planned';

const STATE: Record<StopState, { badge: BadgeVariant; spot: SpotTone }> = {
  done: { badge: 'success', spot: 'success' },
  review: { badge: 'pending', spot: 'pending' },
  missed: { badge: 'danger', spot: 'danger' },
  next: { badge: 'info', spot: 'info' },
  planned: { badge: 'neutral', spot: 'neutral' },
};

/** Where a stop stands: done, waiting for review, missed, the next one today, or to come. */
export function stopState(item: SyncPlanItem, next: boolean): StopState {
  if (item.status === 'completed') return 'done';
  if (item.status === 'visited') return 'review';
  if (item.status === 'missed') return 'missed';
  return next ? 'next' : 'planned';
}

/**
 * Plan, the prototype's second tab (spec 8.1, M8, decision D104): a day's stops, yesterday, today
 * or tomorrow on the tenant's clock, as a map with the route between the placed ones and as
 * numbered rows in route order with where each stands, each opening its account to check in.
 * The list says what the map shows, so the screen works without a map.
 */
export function PlanScreen() {
  const { t, locale } = useLanguage();
  const theme = useTheme();
  const config = useConfig();
  const accounts = useLocalRows('accounts') ?? [];
  const fix = useFix();
  const settings = config.data?.bundle.settings;
  const today = todayIn(settings?.timezone ?? 'Asia/Kolkata');
  const [day, setDay] = useState(today);
  const { items, waiting } = usePlanDay(day);
  const types = config.data?.bundle.accountTypes ?? [];
  const nextIndex = day === today ? items.findIndex((item) => item.status === 'planned') : -1;
  const stops = items.map((item, index) => {
    const account = accounts.find((entry) => entry.id === item.accountId);
    return {
      item,
      n: index + 1,
      name: account?.name ?? '—',
      type: types.find((entry) => entry.key === account?.type)?.name[locale].one,
      at: account?.location ?? null,
      state: stopState(item, index === nextIndex),
    };
  });
  const placed = stops.flatMap((stop) => (stop.at ? [{ ...stop, at: stop.at }] : []));
  const path: GeoPoint[] = placed.map((stop) => stop.at);
  const me = day === today && fix.status === 'ready' ? fix.fix : null;
  const open = (accountId: string) =>
    router.push({ pathname: '/accounts/[id]', params: { id: accountId } });
  const days = [dayFrom(today, -1), today, dayFrom(today, 1)];
  const summary = [
    t('route.stops', { count: stops.length }),
    path.length > 1
      ? t('plan.km', {
          km: formatNumber(pathLengthMeters(path) / 1000, { locale }, { maximumFractionDigits: 0 }),
        })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={styles.head}>
        <Text variant="headingXl" role="heading" style={styles.grow}>
          {t('plan.screen_title')}
        </Text>
        {/* Where months are approved, only approved days reach the phone (BR-35). */}
        {settings?.journeyPlanApproval && stops.length > 0 ? (
          <StatusBadge variant="success" label={t('plan.month_approved')} />
        ) : null}
      </View>
      <SegmentedControl
        label={t('plan.day')}
        value={day}
        onChange={setDay}
        choices={days.map((date) => ({
          value: date,
          label: date === today ? t('plan.today') : formatDay(date, { locale }),
        }))}
      />
      {stops.length === 0 && waiting.length === 0 ? (
        <EmptyState icon={Route} title={day === today ? t('today.empty') : t('plan.day_empty')}>
          {t('route.empty_body')}
        </EmptyState>
      ) : null}
      {placed.length > 0 ? (
        <View>
          <PhoneMap
            label={t('route.map_label')}
            fit={[...path, ...(me ? [me] : [])]}
            frame={`${day}:${placed.length}:${me ? 'me' : fix.status}`}
            height={200}
          >
            <Line path={path} />
            {placed.map((stop) => (
              <Spot
                key={stop.item.id}
                at={stop.at}
                label={String(stop.n)}
                tone={STATE[stop.state].spot}
                title={`${stop.n}. ${stop.name}`}
                onPress={() => open(stop.item.accountId)}
              />
            ))}
            {me ? <Spot at={me} title={t('visit.you')} tone="accent" /> : null}
          </PhoneMap>
          <View
            style={[
              styles.overlay,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <Text variant="labelSm" weight={600}>
              {summary}
            </Text>
          </View>
        </View>
      ) : null}
      {stops.length > 0 || waiting.length > 0 ? (
        <ListGroup title={summary || t('plan.title')}>
          {stops.map((stop) => (
            <ListRow
              key={stop.item.id}
              lead={
                <SeqBadge
                  n={stop.n}
                  {...(stop.state === 'done'
                    ? { tone: 'done' as const }
                    : stop.state === 'next'
                      ? { tone: 'now' as const }
                      : {})}
                />
              }
              label={stop.name}
              detail={
                [stop.type, stop.item.purpose, stop.at ? null : t('route.no_place')]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
              trailing={
                <StatusBadge
                  variant={STATE[stop.state].badge}
                  label={t(`plan.stop_${stop.state}`)}
                />
              }
              onPress={() => open(stop.item.accountId)}
            />
          ))}
          {waiting.map((item) => (
            <ListRow
              key={item.id}
              icon={Hourglass}
              label={accounts.find((entry) => entry.id === item.accountId)?.name ?? '—'}
              detail={t('today.waiting')}
              onPress={() => open(item.accountId)}
            />
          ))}
        </ListGroup>
      ) : null}
      <Button
        variant="secondary"
        icon={MapPinPlus}
        label={t('plan.add_unplanned')}
        onPress={() => router.push('/accounts')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  grow: { flex: 1 },
  overlay: {
    position: 'absolute',
    left: spacing.space2,
    top: spacing.space2,
    paddingHorizontal: spacing.space2,
    paddingVertical: spacing.space1,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
  },
});
