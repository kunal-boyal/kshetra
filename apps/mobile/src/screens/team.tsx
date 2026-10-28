import { spacing } from '@thelamp/design-tokens';
import { formatNumber } from '@thelamp/i18n';
import { isStale, type LivePerson, type ReviewItem } from '@thelamp/shared';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Flag,
  ListGroup,
  ListRow,
  PhotoTile,
  Screen,
  SegmentedControl,
  Text,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ClipboardCheck, MapPin, RotateCw, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useApprovalInbox } from '../approvals';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { PhoneMap, Spot } from '../maps';
import { useLive } from '../maps-data';
import { useDecide, usePhotoLink, useReviewQueue } from '../review';
import { when } from '../when';

type TeamView = 'review' | 'duty';

/**
 * Team (spec 8.1), for managers, as the prototype's AppTeam (decision D104): how many people, the
 * way to the requests waiting for a decision, and what waits for review and who is on duty now, as
 * two views with their counts. Each view shows only to those who may see it.
 */
export function TeamScreen() {
  const { t, locale } = useLanguage();
  const { client } = useApp();
  const config = useConfig();
  const users = useLocalRows('users');
  const permissions = new Set<string>(config.data?.bundle.access.permissions ?? []);
  const canReview = permissions.has('submission.review');
  const canSeeDuty = permissions.has('live_map.view');
  const canDecide = permissions.has('approval.act') || permissions.has('account.approve');
  const queue = useReviewQueue(canReview);
  const live = useLive(canSeeDuty);
  const inbox = useApprovalInbox(undefined, canDecide);
  const views: TeamView[] = [
    ...(canReview ? ['review' as const] : []),
    ...(canSeeDuty ? ['duty' as const] : []),
  ];
  const [chosen, setChosen] = useState<TeamView>();
  const view = chosen && views.includes(chosen) ? chosen : views[0];
  const self = client.owner?.split(':')[1];
  const people = (users ?? []).filter(
    (user) => user.id !== self && user.status === 'active',
  ).length;
  const waiting = Object.values(inbox.data?.pages[0]?.counts ?? {}).reduce((sum, n) => sum + n, 0);
  const toReview =
    queue.data?.pages[0]?.summary?.counts.pending ??
    queue.data?.pages.flatMap((page) => page.items).length;
  const onDuty = live.data?.people.length;
  const count = (label: string, n: number | undefined) =>
    n === undefined ? label : `${label} · ${formatNumber(n, { locale })}`;

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={styles.head}>
        <View style={styles.grow}>
          <Text variant="headingXl" role="heading">
            {t('team.title')}
          </Text>
          {people > 0 ? (
            <Text variant="bodySm" tone="muted">
              {t('team.people', { count: people })}
            </Text>
          ) : null}
        </View>
        {canDecide ? (
          <Button
            variant="tonal"
            size="sm"
            label={count(t('approvals.title'), inbox.data ? waiting : undefined)}
            onPress={() => router.push('/approvals')}
          />
        ) : null}
      </View>
      {views.length > 1 ? (
        <SegmentedControl
          label={t('team.views')}
          value={view!}
          onChange={setChosen}
          choices={[
            { value: 'review', label: count(t('team.view_review'), toReview) },
            { value: 'duty', label: count(t('team.view_duty'), onDuty) },
          ]}
        />
      ) : null}
      {view === 'review' ? <ReviewQueue /> : null}
      {view === 'duty' ? <OnDutyNow canReplay={permissions.has('trail.view')} /> : null}
      {views.length === 0 && !canDecide ? (
        <EmptyState icon={ClipboardCheck} title={t('team.nothing_title')}>
          {t('team.nothing_body')}
        </EmptyState>
      ) : null}
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
const openItem = (id: string) => router.push({ pathname: '/review/[id]', params: { id } });

/** What waits for the manager's review, newest first (M7), as cards to approve or open. */
function ReviewQueue() {
  const { t } = useLanguage();
  const queue = useReviewQueue();
  const items = queue.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = queue.data?.pages[0]?.summary;

  if (queue.isError) {
    return (
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
    );
  }
  if (queue.isPending) return <Text tone="muted">{t('common.loading')}</Text>;
  return (
    <View style={styles.stack}>
      {items.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={t('review.empty_title')}>
          {t('review.empty_body')}
        </EmptyState>
      ) : (
        items.map((item) => <ReviewCard key={item.id} item={item} />)
      )}
      {queue.hasNextPage ? (
        <Button
          variant="secondary"
          label={t('common.load_more')}
          busy={queue.isFetchingNextPage}
          onPress={() => void queue.fetchNextPage()}
        />
      ) : null}
      {summary?.autoApproval ? (
        <Text variant="bodySm" tone="muted" style={styles.centre}>
          {t('team.auto_approve_note', { count: summary.delayHours })}
        </Text>
      ) : null}
      <Button
        variant="ghost"
        icon={RotateCw}
        label={t('team.refresh')}
        busy={queue.isRefetching}
        onPress={() => void queue.refetch()}
      />
    </View>
  );
}

/** The first words written on a submission, as the card's summary. */
function summaryOf(values: Record<string, unknown>): string | undefined {
  return Object.values(values).find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
}

/**
 * One submission waiting for review (components/ReviewCard on the phone): who and which form,
 * where and when, two of its photos and its first words, its flags, and Open and Approve.
 * Rejecting asks why, so it is done on the submission's own screen.
 */
function ReviewCard({ item }: { item: ReviewItem }) {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const decide = useDecide();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  const summary = summaryOf(item.values);

  async function approve() {
    setBusy(true);
    setFailure(undefined);
    try {
      await decide(item.id, 'approved');
    } catch (error) {
      setFailure(errorMessage(error, t));
      setBusy(false);
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.who}>
        <Avatar name={item.user.name} id={item.user.id} />
        <View style={styles.grow}>
          <Text variant="labelMd" weight={600}>
            {`${item.user.name} · ${item.form.name[locale].one}`}
          </Text>
          <Text variant="bodySm" tone="muted">
            {[item.account?.name, when(item.capturedAt, { t, locale, timeZone })]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </View>
      {item.photoDetails.length > 0 || summary ? (
        <View style={styles.who}>
          {item.photoDetails.slice(0, 2).map((photo, index) => (
            <Thumbnail key={photo.id} id={photo.id} number={index + 1} />
          ))}
          {summary ? (
            <Text variant="bodySm" tone="muted" numberOfLines={3} style={styles.grow}>
              {summary}
            </Text>
          ) : null}
        </View>
      ) : null}
      {item.flags.length > 0 || item.integrityWarning ? (
        <View style={styles.flags}>
          {item.flags.map((flag) => (
            <Flag key={flag} tone="danger" label={t(`submissions.flag_${flag}`)} />
          ))}
          {item.integrityWarning ? <Flag tone="danger" label={t('review.integrity')} /> : null}
        </View>
      ) : null}
      {failure ? (
        <Text tone="danger" role="alert">
          {failure}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          label={t('team.open')}
          aria-label={t('team.open_item', { name: item.user.name })}
          onPress={() => openItem(item.id)}
        />
        <Button
          variant="primary"
          size="sm"
          label={t('review.approve')}
          aria-label={t('team.approve_item', { name: item.user.name })}
          busy={busy}
          onPress={() => void approve()}
        />
      </View>
    </Card>
  );
}

/** A photo's thumbnail, 64 px, once its link answers. */
function Thumbnail({ id, number }: { id: string; number: number }) {
  const { t } = useLanguage();
  const link = usePhotoLink(id);
  return (
    <PhotoTile
      label={t('review.photo_alt', { number })}
      {...(link.data ? { uri: link.data.url } : {})}
    />
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.space2 },
  grow: { flex: 1, minWidth: 0 },
  stack: { gap: spacing.space3 },
  card: { gap: spacing.space3 },
  who: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.space2 },
  centre: { textAlign: 'center' },
});
