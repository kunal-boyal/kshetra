import { spacing } from '@kshetra/design-tokens';
import { formatDateTime, formatNumber } from '@kshetra/i18n';
import { isStale, type LivePerson } from '@kshetra/shared';
import { Button, EmptyState, ListGroup, ListRow, Screen, Text } from '@kshetra/ui-mobile';
import { router } from 'expo-router';
import { ClipboardCheck, MapPin, RotateCw, TriangleAlert } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { PhoneMap, Spot } from '../maps';
import { useLive } from '../maps-data';
import { useReviewQueue } from '../review';

/**
 * Team (spec 8.1), for managers: who is on duty now, and what waits for their review. The
 * approvals inbox and the team's figures join it as their modules arrive.
 */
export function TeamScreen() {
  const { t } = useLanguage();
  const config = useConfig();
  const permissions = new Set<string>(config.data?.bundle.access.permissions ?? []);
  return (
    <Screen>
      <Text variant="headingXl" role="heading">
        {t('team.title')}
      </Text>
      {permissions.has('live_map.view') ? (
        <OnDutyNow canReplay={permissions.has('trail.view')} />
      ) : null}
      {permissions.has('submission.review') ? <ReviewQueue /> : null}
    </Screen>
  );
}

/**
 * Who is on duty now (M17): where each person was last seen on a small map, and in a list with how
 * long ago, flagged after 15 minutes, and their current visit. A person opens their day.
 */
function OnDutyNow({ canReplay }: { canReplay: boolean }) {
  const { t, locale } = useLanguage();
  const live = useLive();
  // Ages are measured at the moment the server answered.
  const now = live.data ? Date.parse(live.data.readAt) : 0;
  const people = live.data?.people ?? [];
  const placed = people.flatMap((person) =>
    person.position ? [{ person, at: person.position }] : [],
  );
  const stale = (person: LivePerson) => !person.seenAt || isStale(person.seenAt, new Date(now));
  const minutes = (at: string) => Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));

  if (live.isError) {
    return (
      <Text tone="danger" role="alert">
        {errorMessage(live.error, t)}
      </Text>
    );
  }
  if (live.isPending) return <Text tone="muted">{t('common.loading')}</Text>;
  return (
    <View style={styles.stack}>
      {placed.length > 0 ? (
        <PhoneMap
          label={t('live.map_label')}
          fit={placed.map((entry) => entry.at)}
          frame={String(placed.length)}
          height={200}
        >
          {placed.map(({ person, at }) => (
            <Spot
              key={person.user.id}
              at={at}
              title={person.user.name}
              tone={stale(person) ? 'danger' : 'accent'}
              {...(canReplay ? { onPress: () => openDay(person.user.id) } : {})}
            />
          ))}
        </PhoneMap>
      ) : null}
      <ListGroup title={t('live.on_duty', { count: people.length })}>
        {people.length === 0 ? <Text tone="muted">{t('live.empty_body')}</Text> : null}
        {people.map((person) => (
          <ListRow
            key={person.user.id}
            icon={stale(person) ? TriangleAlert : MapPin}
            tone={stale(person) ? 'danger' : 'default'}
            label={person.user.name}
            detail={[
              person.seenAt
                ? t('live.seen', {
                    count: minutes(person.seenAt),
                    minutes: formatNumber(minutes(person.seenAt), { locale }),
                  })
                : t('live.no_position'),
              stale(person) ? t('live.stale') : null,
              person.paused ? t('live.paused') : null,
              person.visit ? t('live.visiting', { name: person.visit.account.name }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {...(canReplay ? { onPress: () => openDay(person.user.id) } : {})}
          />
        ))}
      </ListGroup>
    </View>
  );
}

const openDay = (id: string) => router.push({ pathname: '/day/[id]', params: { id } });

/** What waits for the manager's review, newest first (M7). */
function ReviewQueue() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const queue = useReviewQueue();
  const items = queue.data?.pages.flatMap((page) => page.items) ?? [];
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';

  return (
    <>
      {queue.isError ? (
        <View style={styles.stack}>
          <Text tone="danger" role="alert">
            {errorMessage(queue.error, t)}
          </Text>
          <Button
            variant="secondary"
            icon={RotateCw}
            label={t('common.retry')}
            onPress={() => void queue.refetch()}
          />
        </View>
      ) : queue.isPending ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : items.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={t('review.empty_title')}>
          {t('review.empty_body')}
        </EmptyState>
      ) : (
        <ListGroup title={t('team.to_review', { count: items.length })}>
          {items.map((item) => (
            <ListRow
              key={item.id}
              icon={item.flags.length > 0 || item.integrityWarning ? TriangleAlert : ClipboardCheck}
              tone={item.flags.length > 0 || item.integrityWarning ? 'danger' : 'default'}
              label={`${item.form.name[locale].one} · ${item.user.name}`}
              detail={[
                item.account?.name,
                formatDateTime(new Date(item.capturedAt), { locale, timeZone }),
                item.flags.length > 0 ? t('team.flags', { count: item.flags.length }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              onPress={() => router.push({ pathname: '/review/[id]', params: { id: item.id } })}
            />
          ))}
        </ListGroup>
      )}
      {queue.hasNextPage ? (
        <Button
          variant="secondary"
          label={t('common.load_more')}
          busy={queue.isFetchingNextPage}
          onPress={() => void queue.fetchNextPage()}
        />
      ) : null}
      {queue.isSuccess ? (
        <Button
          variant="ghost"
          icon={RotateCw}
          label={t('team.refresh')}
          busy={queue.isRefetching}
          onPress={() => void queue.refetch()}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
});
