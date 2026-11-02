import { spacing } from '@thelamp/design-tokens';
import { formatNumber } from '@thelamp/i18n';
import { StockQuantity } from '@thelamp/shared';
import { Button, Card, EmptyState, Notice, Screen, Text, TextField } from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, Boxes } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useApp } from '../app-state';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { queueCount, useAccountStock } from '../stock';
import { useSync } from '../sync';

/** A typed quantity, without the separators people type. */
const typed = (value: string) => value.trim().replace(/,/g, '');

/**
 * `/stock-count/<accountId>`: counting an account's stock (BR-62, decision D130), offline. The
 * items it holds come first; the person types what is there, items left empty aren't counted, and
 * the count queues to set the stock once it uploads, gaps past the tolerance flagged there.
 */
export function StockCountScreen({ accountId }: { accountId: string }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const sync = useSync();
  const accounts = useLocalRows('accounts');
  const items = useLocalRows('items');
  const stock = useAccountStock(accountId);
  const account = accounts?.find((entry) => entry.id === accountId);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const number = (value: string) => formatNumber(value as `${number}`, { locale });

  async function save() {
    if (!sync || !client.owner) return;
    setError(undefined);
    setSaved(false);
    const lines = Object.entries(drafts)
      .filter(([, value]) => typed(value) !== '')
      .map(([itemId, value]) => ({ itemId, counted: typed(value) }));
    if (lines.length === 0) {
      setError(t('stock.nothing_counted'));
      return;
    }
    if (lines.some((line) => !StockQuantity.safeParse(line.counted).success)) {
      setError(t('stock.count_issue'));
      return;
    }
    setBusy(true);
    try {
      await queueCount(sync, client.owner, accountId, lines);
      setDrafts({});
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  const needle = q.trim().toLowerCase();
  const heldFirst = (itemId: string) => (stock?.has(itemId) ? 0 : 1);
  const shown = (items ?? [])
    .filter((item) => item.active)
    .filter(
      (item) =>
        !needle ||
        item.name.toLowerCase().includes(needle) ||
        item.code.toLowerCase().includes(needle),
    )
    .sort((a, b) => heldFirst(a.id) - heldFirst(b.id) || a.name.localeCompare(b.name));

  return (
    <Screen>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/accounts'))}
      />
      <Text variant="headingXl" role="heading">
        {t('stock.count_at', { name: account?.name ?? '' })}
      </Text>
      <Text tone="muted">{t('stock.count_help')}</Text>
      {saved ? <Notice tone="success">{t('stock.count_queued')}</Notice> : null}
      <TextField label={t('stock.search')} labelHidden value={q} onChangeText={setQ} />
      {accounts !== undefined && !account ? (
        <Text tone="muted">{t('account.gone')}</Text>
      ) : stock === undefined || items === undefined ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : shown.length === 0 ? (
        <EmptyState icon={Boxes} title={t('stock.no_items')}>
          {null}
        </EmptyState>
      ) : (
        shown.map((item) => {
          const current = stock.get(item.id);
          return (
            <Card key={item.id} style={styles.card}>
              <Text weight={600}>{item.name}</Text>
              <Text tone="muted">
                {item.code}
                {current !== undefined
                  ? ` · ${t('stock.on_hand_now', { count: number(current), unit: item.baseUnit })}`
                  : ''}
              </Text>
              <TextField
                label={t('stock.counted_of', { name: item.name })}
                labelHidden
                numeric
                keyboardType="decimal-pad"
                value={drafts[item.id] ?? ''}
                onChangeText={(value) =>
                  setDrafts((existing) => ({ ...existing, [item.id]: value }))
                }
              />
            </Card>
          );
        })
      )}
      {error ? (
        <Text tone="danger" role="alert">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('stock.save_count')}
        variant="primary"
        disabled={busy || Object.values(drafts).every((value) => typed(value) === '')}
        onPress={() => void save()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.space2 },
});
