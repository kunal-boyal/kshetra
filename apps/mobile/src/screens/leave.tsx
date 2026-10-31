import { spacing } from '@thelamp/design-tokens';
import { formatDate, formatDateTime, formatNumber } from '@thelamp/i18n';
import { todayIn } from '@thelamp/shared';
import {
  AppBar,
  type BadgeVariant,
  Button,
  Card,
  EmptyState,
  ListGroup,
  ListRow,
  Screen,
  StatusBadge,
  Text,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { CalendarPlus, CalendarX, RotateCw } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useLeaveBalances, useLeaveTypes, useMyLeave, useQueuedLeave } from '../leave';

const STATE_BADGE: Record<'pending' | 'approved' | 'rejected' | 'cancelled', BadgeVariant> = {
  pending: 'pending',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

/**
 * Leave on the phone (spec 8.1 Me, M13): each type's balance in its quota year, this year's
 * requests with their state, and those still waiting to upload. Read last, it shows offline.
 */
export function LeaveScreen() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  const year = todayIn(timeZone).slice(0, 4);
  const types = useLeaveTypes();
  const balances = useLeaveBalances();
  const mine = useMyLeave(year);
  const queued = useQueuedLeave();
  const permissions = new Set<string>(config.data?.bundle.access.permissions ?? []);
  const names = new Map((types.data ?? []).map((type) => [type.key, type.name[locale]] as const));
  const nameOf = (key: string) => names.get(key) ?? key;
  const number = (value: number) => formatNumber(value, { locale }, { maximumFractionDigits: 1 });
  const dates = (from: string, to: string) =>
    from === to
      ? formatDate(from, { locale })
      : t('leave.dates', { from: formatDate(from, { locale }), to: formatDate(to, { locale }) });
  const failed = balances.error ?? mine.error;

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <AppBar
        title={t('leave.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        backLabel={t('common.back')}
      />
      {permissions.has('leave.request') ? (
        <Button
          variant="primary"
          icon={CalendarPlus}
          label={t('leave.ask')}
          onPress={() => router.push('/leave/new')}
        />
      ) : null}

      {!balances.data || !mine.data ? (
        failed ? (
          <View style={styles.stack}>
            <Text tone="danger" role="alert">
              {errorMessage(failed, t)}
            </Text>
            <Button
              variant="secondary"
              icon={RotateCw}
              label={t('common.retry')}
              onPress={() => {
                void balances.refetch();
                void mine.refetch();
              }}
            />
          </View>
        ) : (
          <Text tone="muted">{t('common.loading')}</Text>
        )
      ) : (
        <>
          <Text variant="bodySm" tone="muted">
            {t('leave.read_at', {
              time: formatDateTime(balances.data.readAt, { locale, timeZone }),
            })}
          </Text>
          <ListGroup title={t('leave.balances')}>
            {balances.data.data.items.map((balance) => (
              <ListRow
                key={balance.leaveType}
                label={nameOf(balance.leaveType)}
                detail={[
                  balance.quota === null
                    ? t('leave.no_limit')
                    : t('leave.left_of', {
                        left: number(balance.available ?? 0),
                        quota: number(balance.quota),
                      }),
                  // A monthly type's days so far, and what came from last year (D114).
                  ...(typeof balance.credited === 'number' && balance.credited !== balance.quota
                    ? [t('leave.credited_so_far', { days: number(balance.credited) })]
                    : []),
                  ...(balance.carriedIn > 0
                    ? [t('leave.carried_in', { days: number(balance.carriedIn) })]
                    : []),
                  t('leave.taken', { days: number(balance.approved) }),
                  ...(balance.pending > 0
                    ? [t('leave.waiting', { days: number(balance.pending) })]
                    : []),
                ].join(' · ')}
              />
            ))}
          </ListGroup>

          <Text variant="headingMd" role="heading">
            {t('leave.requests')}
          </Text>
          {queued.length === 0 && mine.data.length === 0 ? (
            <EmptyState icon={CalendarX} title={t('leave.none_title')}>
              {t('leave.none_body')}
            </EmptyState>
          ) : (
            <View style={styles.stack}>
              {queued.map((request) => (
                <Card key={request.id} style={styles.request}>
                  <View style={styles.texts}>
                    <Text weight={600}>{nameOf(request.leaveType)}</Text>
                    <Text tone="muted">{dates(request.startDate, request.endDate)}</Text>
                  </View>
                  <StatusBadge variant="waiting" label={t('leave.queued')} />
                </Card>
              ))}
              {mine.data.map((request) => (
                <Card key={request.id} style={styles.request}>
                  <View style={styles.texts}>
                    <Text weight={600}>{nameOf(request.leaveType)}</Text>
                    <Text tone="muted">
                      {[
                        dates(request.startDate, request.endDate),
                        request.halfDay
                          ? t('leave.half')
                          : t('leave.working_days', { count: request.days }),
                      ].join(' · ')}
                    </Text>
                  </View>
                  <StatusBadge
                    variant={STATE_BADGE[request.state]}
                    label={t(`approval.status_${request.state}`)}
                  />
                </Card>
              ))}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
  request: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.space3,
  },
  texts: { flex: 1, gap: spacing.space1 },
});
