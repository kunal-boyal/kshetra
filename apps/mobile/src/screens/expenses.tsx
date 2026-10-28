import { spacing } from '@thelamp/design-tokens';
import { formatDate, formatDateTime, formatMoney, formatMonth } from '@thelamp/i18n';
import { type ExpenseClaimResult, scaled, todayIn, unscaled } from '@thelamp/shared';
import {
  AppBar,
  type BadgeVariant,
  Button,
  Card,
  EmptyState,
  Flag,
  IconButton,
  IconChip,
  PhotoTile,
  Screen,
  StatusBadge,
  Text,
} from '@thelamp/ui-mobile';
import { router, useFocusEffect } from 'expo-router';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Receipt,
  ReceiptText,
  RotateCw,
} from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { takeResults } from '../capture-results';
import { useConfig } from '../data';
import { queueReceipts, useExpensePolicies, useMyClaims, useQueuedExpenses } from '../expenses';
import { errorMessage, useLanguage } from '../i18n';
import { usePhotoLink } from '../review';
import { useSync } from '../sync';
import { shiftMonth } from './month-days';

const STATE_BADGE: Record<ExpenseClaimResult['state'], BadgeVariant> = {
  pending: 'pending',
  approved: 'info',
  rejected: 'danger',
  cancelled: 'neutral',
  paid: 'success',
};

/** The camera request a receipt for a claim comes back under. */
const receiptRequest = (claimId: string) => `receipt:${claimId}`;

/**
 * Expenses on the phone (spec 8.1 Me, M12): the person's claims for a month with their amounts,
 * caps, flags and state, those still waiting to upload, and a receipt added to a waiting claim
 * from the camera. Read last, the month shows offline.
 */
export function ExpensesScreen() {
  const { t, locale } = useLanguage();
  const { client } = useApp();
  const sync = useSync();
  const config = useConfig();
  const settings = config.data?.bundle.settings;
  const timeZone = settings?.timezone ?? 'Asia/Kolkata';
  const currency = settings?.currency ?? 'INR';
  const thisMonth = todayIn(timeZone).slice(0, 7);
  const [period, setPeriod] = useState(thisMonth);
  const policies = useExpensePolicies();
  const claims = useMyClaims(period);
  const queued = useQueuedExpenses();
  const waitingFor = useRef<string | null>(null);
  const permissions = new Set<string>(config.data?.bundle.access.permissions ?? []);
  const names = new Map(
    (policies.data ?? []).map((policy) => [policy.key, policy.name[locale]] as const),
  );
  const nameOf = (key: string) => names.get(key) ?? key;
  const money = (amount: string) => formatMoney(amount as `${number}`, { locale, currency });
  const queuedClaims = queued.claims.filter((claim) => claim.expenseDate.startsWith(period));
  const receiptsQueued = new Set(queued.receipts.map((entry) => entry.claimId));
  // What the month claims, neither turned down nor withdrawn, exact as paise.
  const total = unscaled(
    (claims.data?.data ?? [])
      .filter((claim) => claim.state !== 'rejected' && claim.state !== 'cancelled')
      .reduce((sum, claim) => sum + scaled(claim.amount, 2), 0n),
    2,
  );

  // Back from the camera with a receipt for a waiting claim.
  useFocusEffect(
    useCallback(() => {
      const claimId = waitingFor.current;
      if (!claimId || !sync || !client.owner) return;
      const mediaIds = takeResults(receiptRequest(claimId));
      if (mediaIds.length === 0) return;
      waitingFor.current = null;
      void (async () => {
        await queueReceipts(sync, client.owner!, { claimId, mediaIds });
        await sync.runner.refresh();
        void sync.runner.sync();
      })();
    }, [sync, client]),
  );

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <AppBar
        title={t('claims.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        backLabel={t('common.back')}
      />
      {permissions.has('expense.claim') ? (
        <Button
          variant="primary"
          icon={ReceiptText}
          label={t('claims.new')}
          onPress={() => router.push('/expenses/new')}
        />
      ) : null}
      <View style={styles.months}>
        <IconButton
          icon={ChevronLeft}
          label={t('attendance.previous')}
          onPress={() => setPeriod(shiftMonth(period, -1))}
        />
        <Text variant="headingMd" style={styles.month}>
          {formatMonth(period, { locale })}
        </Text>
        <IconButton
          icon={ChevronRight}
          label={t('attendance.next')}
          disabled={period >= thisMonth}
          onPress={() => setPeriod(shiftMonth(period, 1))}
        />
      </View>

      {!claims.data ? (
        claims.isError ? (
          <View style={styles.stack}>
            <Text tone="danger" role="alert">
              {errorMessage(claims.error, t)}
            </Text>
            <Button
              variant="secondary"
              icon={RotateCw}
              label={t('common.retry')}
              onPress={() => void claims.refetch()}
            />
          </View>
        ) : (
          <Text tone="muted">{t('common.loading')}</Text>
        )
      ) : (
        <>
          <Text variant="bodySm" tone="muted">
            {t('claims.read_at', {
              time: formatDateTime(claims.data.readAt, { locale, timeZone }),
            })}
          </Text>
          {claims.data.data.length > 0 ? (
            <Card style={styles.total}>
              <Text variant="labelLg" style={styles.texts}>
                {t('claims.month_total')}
              </Text>
              <Text variant="headingLg" style={styles.figure}>
                {money(total)}
              </Text>
            </Card>
          ) : null}
          {queuedClaims.length === 0 && claims.data.data.length === 0 ? (
            <EmptyState icon={Receipt} title={t('claims.none_title')}>
              {t('claims.none_body')}
            </EmptyState>
          ) : (
            <View style={styles.stack}>
              {queuedClaims.map((claim) => (
                <Card key={claim.id} style={styles.claim}>
                  <View style={styles.texts}>
                    <Text weight={600}>{nameOf(claim.policy)}</Text>
                    <Text tone="muted">
                      {`${formatDate(claim.expenseDate, { locale })} · ${claim.description}`}
                    </Text>
                  </View>
                  <StatusBadge variant="waiting" label={t('claims.queued')} />
                </Card>
              ))}
              {claims.data.data.map((claim) => (
                <Card key={claim.id} style={styles.stack}>
                  <View style={styles.claim}>
                    <ReceiptThumb id={claim.receipts[0]} />
                    <View style={styles.texts}>
                      <Text weight={600}>{nameOf(claim.policy)}</Text>
                      <Text variant="bodySm" tone="muted">
                        {`${formatDate(claim.expenseDate, { locale })} · ${claim.description}`}
                      </Text>
                      {claim.capped ? (
                        <Text variant="bodySm" tone="muted">
                          {t('claims.capped_from', { amount: money(claim.calculated) })}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.end}>
                      <Text weight={600} style={styles.figure}>
                        {money(claim.amount)}
                      </Text>
                      <StatusBadge
                        variant={STATE_BADGE[claim.state]}
                        label={
                          claim.state === 'paid'
                            ? t('claims.state_paid')
                            : t(`approval.status_${claim.state}`)
                        }
                      />
                    </View>
                  </View>
                  {claim.flags.some((flag) => flag !== 'capped') ? (
                    <View style={styles.flags}>
                      {claim.flags
                        .filter((flag) => flag !== 'capped')
                        .map((flag) => (
                          <Flag
                            key={flag}
                            tone={flag === 'duplicate_receipt' ? 'danger' : 'waiting'}
                            label={t(
                              `claims.flag_${flag as 'receipt_missing' | 'duplicate_receipt' | 'odometer_changed'}`,
                            )}
                          />
                        ))}
                    </View>
                  ) : null}
                  {claim.state === 'pending' ? (
                    receiptsQueued.has(claim.id) ? (
                      <Text tone="muted">{t('claims.receipt_queued')}</Text>
                    ) : (
                      <Button
                        variant="secondary"
                        icon={Camera}
                        label={t('claims.add_receipt')}
                        onPress={() => {
                          waitingFor.current = claim.id;
                          router.push({
                            pathname: '/camera',
                            params: { kind: 'receipt', request: receiptRequest(claim.id) },
                          });
                        }}
                      />
                    )
                  ) : null}
                </Card>
              ))}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

/** A claim's first receipt, or a receipt chip when it has none. */
function ReceiptThumb({ id }: { id: string | undefined }) {
  const { t } = useLanguage();
  const link = usePhotoLink(id ?? '', id !== undefined);
  if (!id) return <IconChip icon={Receipt} hue="sand" />;
  return (
    <PhotoTile label={t('claims.receipt_photo')} {...(link.data ? { uri: link.data.url } : {})} />
  );
}

const styles = StyleSheet.create({
  total: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  figure: { fontVariant: ['tabular-nums'], textAlign: 'right' },
  end: { alignItems: 'flex-end', gap: spacing.space1 },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space1 },
  stack: { gap: spacing.space3 },
  months: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month: { flex: 1, textAlign: 'center' },
  claim: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.space3,
  },
  texts: { flex: 1, gap: spacing.space1 },
});
