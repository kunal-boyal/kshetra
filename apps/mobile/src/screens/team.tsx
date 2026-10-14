import { spacing } from '@kshetra/design-tokens';
import { formatDateTime } from '@kshetra/i18n';
import { Button, EmptyState, ListGroup, ListRow, Screen, Text } from '@kshetra/ui-mobile';
import { router } from 'expo-router';
import { ClipboardCheck, RotateCw, TriangleAlert } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useReviewQueue } from '../review';

/**
 * Team (spec 8.1), for managers: what waits for their review, newest first. Who is on duty, the
 * approvals inbox and the team's figures join it as their modules arrive.
 */
export function TeamScreen() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const queue = useReviewQueue();
  const items = queue.data?.pages.flatMap((page) => page.items) ?? [];
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';

  return (
    <Screen>
      <Text variant="headingXl" role="heading">
        {t('team.title')}
      </Text>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
});
