import { spacing } from '@thelamp/design-tokens';
import { formatDay, formatNumber } from '@thelamp/i18n';
import type { ApprovalResult, Locale, RequestType } from '@thelamp/shared';
import {
  AppBar,
  Avatar,
  type BadgeVariant,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  Screen,
  StatusBadge,
  Text,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { Inbox, RotateCw } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDecideRequest, useApprovalInbox } from '../approvals';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { ago } from '../when';

/** Each request type's badge, as the portal's inbox colours them. */
export const TYPE_BADGE: Record<RequestType, BadgeVariant> = {
  leave: 'info',
  regularisation: 'pending',
  expense: 'waiting',
  order: 'danger',
  new_account: 'info',
  account_location_change: 'info',
  journey_plan: 'neutral',
  target_lock: 'neutral',
};

const ALL = 'all';

/** A subject's calendar dates, which the server sends as data, written as the reader reads them. */
export function readable(title: string, locale: Locale): string {
  return title.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => formatDay(date, { locale }));
}

const openRequest = (id: string) => router.push({ pathname: '/approvals/[id]', params: { id } });

/**
 * `/approvals`: what waits for the person's decision (M15, decision D76), as the prototype's
 * AppApprovals (D104): the types as chips with their counts, and a card for each request with its
 * kind (and whom the person decides for, when someone handed over to them, D113), how long ago,
 * who asked and about what, their words, where it stands in its chain, and
 * Reject and Approve. Rejecting asks why, so it opens the request; one decided on its own page
 * offers Open instead of Approve.
 */
export function ApprovalsScreen() {
  const { t, locale } = useLanguage();
  const [type, setType] = useState<RequestType | typeof ALL>(ALL);
  const inbox = useApprovalInbox(type === ALL ? undefined : type);
  const counts = inbox.data?.pages[0]?.counts ?? {};
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];
  const types = (Object.keys(counts) as RequestType[]).filter((key) => (counts[key] ?? 0) > 0);
  const label = (text: string, n: number) => `${text} · ${formatNumber(n, { locale })}`;

  return (
    <Screen>
      <AppBar
        title={t('approvals.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/team'))}
        backLabel={t('approvals.back_to_team')}
      />
      {types.length > 1 ? (
        <ChipGroup
          label={t('approvals.types')}
          value={type}
          onChange={setType}
          choices={[
            { value: ALL, label: label(t('approvals.all'), total) },
            ...types.map((key) => ({
              value: key,
              label: label(t(`approval.type_${key}`), counts[key] ?? 0),
            })),
          ]}
        />
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
      ) : inbox.isPending ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : items.length === 0 ? (
        <EmptyState icon={Inbox} title={t('approvals.empty_title')}>
          {t('approvals.empty_body')}
        </EmptyState>
      ) : (
        items.map((item) => <RequestCard key={item.id} item={item} />)
      )}
      {inbox.hasNextPage ? (
        <Button
          variant="secondary"
          label={t('common.load_more')}
          busy={inbox.isFetchingNextPage}
          onPress={() => void inbox.fetchNextPage()}
        />
      ) : null}
    </Screen>
  );
}

/** Where a request stands: the caller decides last, or a later step follows theirs. */
function stepLine(item: ApprovalResult, t: ReturnType<typeof useLanguage>['t']): string {
  const at = item.steps.findIndex((step) => step.status === 'pending');
  if (at < 0 || at === item.steps.length - 1) return t('approvals.you_decide');
  const next = item.steps[at + 1]!.approvers.map((person) => person.name).join(', ');
  return next
    ? t('approvals.step_then', { at: at + 1, of: item.steps.length, next })
    : t('approvals.step_of', { at: at + 1, of: item.steps.length });
}

/** One request waiting for the person, with Reject and Approve, or Open. */
function RequestCard({ item }: { item: ApprovalResult }) {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const decide = useDecideRequest();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  const kind = t(`approval.type_${item.requestType}`);
  const title = [item.requester.name, readable(item.subject.title, locale)]
    .filter(Boolean)
    .join(' · ');

  async function approve() {
    setBusy(true);
    setFailure(undefined);
    try {
      await decide(item, 'approve');
    } catch (error) {
      setFailure(errorMessage(error, t));
      setBusy(false);
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.spread}>
        <View style={styles.badges}>
          <StatusBadge variant={TYPE_BADGE[item.requestType]} label={kind} />
          {item.onBehalfOf ? (
            // Waiting for someone who handed over to this person (decision D113).
            <StatusBadge
              variant="info"
              label={t('approvals.on_behalf', { name: item.onBehalfOf.name })}
            />
          ) : null}
        </View>
        <Text variant="caption" tone="subtle">
          {ago(item.createdAt, { t, locale, timeZone })}
        </Text>
      </View>
      <View style={styles.who}>
        <Avatar name={item.requester.name} id={item.requester.id} />
        <View style={styles.grow}>
          <Text variant="labelMd" weight={600}>
            {title}
          </Text>
          {item.subject.detail ? (
            <Text variant="bodySm" tone="muted" numberOfLines={2}>
              {item.subject.detail}
            </Text>
          ) : null}
        </View>
      </View>
      <Text variant="caption" tone="muted">
        {stepLine(item, t)}
      </Text>
      {failure ? (
        <Text tone="danger" role="alert">
          {failure}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {item.page ? (
          // Decided on its own page, which asks for more than a note (decision D78).
          <Button
            variant="primary"
            size="sm"
            label={t('team.open')}
            aria-label={t('approvals.open_request', { name: title })}
            onPress={() => openRequest(item.id)}
          />
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              label={t('approvals.reject')}
              aria-label={t('approvals.reject_request', { name: title })}
              onPress={() => openRequest(item.id)}
            />
            <Button
              variant="primary"
              size="sm"
              label={t('approvals.approve')}
              aria-label={t('approvals.approve_request', { name: title })}
              busy={busy}
              onPress={() => void approve()}
            />
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  card: { gap: spacing.space3 },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2, flexShrink: 1 },
  who: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  grow: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.space2 },
});
