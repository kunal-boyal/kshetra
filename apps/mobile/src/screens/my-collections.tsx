import { spacing } from '@thelamp/design-tokens';
import { formatDate, formatMoney } from '@thelamp/i18n';
import { type CollectionStatusKey, scaled, todayIn, unscaled } from '@thelamp/shared';
import {
  AppBar,
  type BadgeVariant,
  Button,
  Card,
  EmptyState,
  Screen,
  StatusBadge,
  Text,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { HandCoins, Share2 } from 'lucide-react-native';
import { Share, StyleSheet, View } from 'react-native';
import { mine, paidBy, type PhoneCollection, receiptMessage, useCollections } from '../collections';
import { useConfig, useMe } from '../data';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';

const STATUS_BADGE: Record<CollectionStatusKey, BadgeVariant> = {
  recorded: 'pending',
  confirmed: 'info',
  in_books: 'success',
  rejected: 'danger',
  bounced: 'danger',
};

/**
 * My collections (M11, BR-63, decision D132), under More: the person's own of the last 60 days,
 * newest first, with what the office decided and why money was turned down, and those still on
 * the phone. Read from the phone's copy, so it shows offline; each that stands can be shared again
 * as a receipt.
 */
export function MyCollectionsScreen() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const me = useMe();
  const accounts = useLocalRows('accounts');
  const settings = config.data?.bundle.settings;
  const timezone = settings?.timezone ?? 'Asia/Kolkata';
  const all = useCollections(timezone);
  const own = all ? mine(all, me.data?.userId) : undefined;
  const money = (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: settings?.currency ?? 'INR' });
  const thisMonth = todayIn(timezone).slice(0, 7);
  // This month's money that stands: neither rejected nor bounced, exact as paise.
  const month = (own ?? []).filter(
    (entry) =>
      entry.collectedOn.startsWith(thisMonth) &&
      entry.status !== 'rejected' &&
      entry.status !== 'bounced',
  );
  const total = unscaled(
    month.reduce((sum, entry) => sum + scaled(entry.amount, 2), 0n),
    2,
  );
  const waiting = (own ?? []).filter((entry) => entry.status === 'recorded').length;
  const accountOf = (id: string) => accounts?.find((entry) => entry.id === id);

  async function share(collection: PhoneCollection) {
    const account = accountOf(collection.accountId);
    const message = receiptMessage(
      { ...collection, date: formatDate(collection.collectedOn, { locale }) },
      { name: account?.name ?? '', code: account?.code ?? '' },
      me.data?.name ?? null,
      t,
      money,
    );
    if (message) await Share.share({ message }).catch(() => undefined);
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <AppBar
        title={t('my_collections.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        backLabel={t('common.back')}
      />
      {own === undefined ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : own.length === 0 ? (
        <EmptyState icon={HandCoins} title={t('my_collections.empty_title')}>
          {t('my_collections.empty_body')}
        </EmptyState>
      ) : (
        <>
          <Card style={styles.stack}>
            <View style={styles.figure}>
              <Text tone="muted" style={styles.grow}>
                {t('my_collections.this_month')}
              </Text>
              <Text weight={600} style={styles.amount}>
                {money(total)}
              </Text>
            </View>
            <View style={styles.figure}>
              <Text tone="muted" style={styles.grow}>
                {t('collections.tile_waiting')}
              </Text>
              <Text weight={600} style={styles.amount}>
                {t('collections.tile_count', { count: waiting, n: waiting })}
              </Text>
            </View>
          </Card>
          {own.map((collection) => {
            const account = accountOf(collection.accountId);
            const standing = collection.status !== 'rejected' && collection.status !== 'bounced';
            return (
              <Card
                key={collection.id}
                style={styles.stack}
                role="group"
                aria-label={collection.number ?? t('my_collections.on_phone')}
              >
                <View style={styles.figure}>
                  <Text weight={600} style={styles.grow}>
                    {account?.name ?? '—'}
                  </Text>
                  <Text weight={600} style={styles.amount}>
                    {money(collection.amount)}
                  </Text>
                </View>
                <Text variant="bodySm" tone="muted">
                  {[
                    collection.number ?? t('my_collections.on_phone'),
                    formatDate(collection.collectedOn, { locale }),
                    paidBy(collection, t(`collections.mode_${collection.mode}`)),
                  ].join(' · ')}
                </Text>
                <View style={styles.figure}>
                  <StatusBadge
                    variant={collection.queued ? 'neutral' : STATUS_BADGE[collection.status]}
                    label={
                      collection.queued
                        ? t('my_collections.waiting_upload')
                        : t(`collections.status_${collection.status}`)
                    }
                  />
                </View>
                {collection.reason ? (
                  <Text tone={standing ? 'muted' : 'danger'}>
                    {t('my_collections.reason', { reason: collection.reason })}
                  </Text>
                ) : null}
                {standing ? (
                  <Button
                    variant="ghost"
                    icon={Share2}
                    label={t('collect.share')}
                    onPress={() => void share(collection)}
                  />
                ) : null}
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  grow: { flex: 1 },
  figure: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  amount: { fontVariant: ['tabular-nums'] },
});
