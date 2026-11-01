import { spacing } from '@thelamp/design-tokens';
import { formatNumber } from '@thelamp/i18n';
import {
  previousPeriod,
  type SellThroughLineBody,
  statementOpen,
  StockQuantity,
  todayIn,
} from '@thelamp/shared';
import {
  Button,
  Card,
  EmptyState,
  Flag,
  Notice,
  Screen,
  SegmentedControl,
  Text,
  TextField,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, PackageCheck } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useConfig } from '../data';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { lineFrom, queueStatement, type StatementLine, useStatement } from '../sell-through';
import { useSync } from '../sync';

interface Draft {
  received: string;
  returned: string;
  closing: string;
}

const blank: Draft = { received: '', returned: '', closing: '' };

/** A typed quantity, or what it stands for when left empty. */
const typed = (value: string, empty: string) => value.trim().replace(/,/g, '') || empty;

/**
 * `/sell-through/<accountId>`: an account's stock statement for the month (BR-53, decision D124),
 * in the template's word, such as liquidation. Each item starts from last month's closing; the
 * person types what came in, went back and is left, sees what sold through as the server will
 * work it out, and saves offline. Last month stays open for its first days after.
 */
export function SellThroughScreen({ accountId }: { accountId: string }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const sync = useSync();
  const config = useConfig();
  const accounts = useLocalRows('accounts');
  const items = useLocalRows('items');
  const account = accounts?.find((entry) => entry.id === accountId);
  const today = todayIn(config.data?.bundle.settings.timezone ?? 'Asia/Kolkata');
  const thisMonth = today.slice(0, 7);
  const lastMonth = previousPeriod(thisMonth);
  const lastOpen = statementOpen(lastMonth, today);
  const [period, setPeriod] = useState(thisMonth);
  const statement = useStatement(accountId, period);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const number = (value: string) => formatNumber(Number(value), { locale });

  /** What the person typed for an item, over its current line. */
  const sentFor = (itemId: string, line: StatementLine | undefined): SellThroughLineBody | null => {
    const draft = drafts[itemId];
    if (!draft) return null;
    return {
      itemId,
      received: typed(draft.received, line?.received ?? '0'),
      returned: typed(draft.returned, line?.returned ?? '0'),
      closing: typed(draft.closing, line?.closing ?? ''),
    };
  };

  async function save() {
    if (!statement || !sync || !client.owner) return;
    setError(undefined);
    setSaved(false);
    const lines = Object.keys(drafts).flatMap((itemId) => {
      const sent = sentFor(itemId, statement.lines.get(itemId));
      return sent ? [sent] : [];
    });
    if (lines.length === 0) {
      setError(t('sell_through.nothing_changed'));
      return;
    }
    const wrong = lines.some(
      (line) =>
        ![line.received, line.returned, line.closing].every(
          (value) => StockQuantity.safeParse(value).success,
        ),
    );
    if (wrong) {
      setError(t('sell_through.quantity_issue'));
      return;
    }
    setBusy(true);
    try {
      await queueStatement(sync, client.owner, accountId, period, lines);
      setDrafts({});
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  const needle = q.trim().toLowerCase();
  const known = (itemId: string) =>
    statement?.lines.has(itemId) || statement?.carried.has(itemId) ? 0 : 1;
  const shown = (items ?? [])
    .filter((item) => item.active)
    .filter(
      (item) =>
        !needle ||
        item.name.toLowerCase().includes(needle) ||
        item.code.toLowerCase().includes(needle),
    )
    .sort((a, b) => known(a.id) - known(b.id) || a.name.localeCompare(b.name));

  return (
    <Screen>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/accounts'))}
      />
      <Text variant="headingXl" role="heading">
        {t('sell_through.at', { name: account?.name ?? '' })}
      </Text>
      {lastOpen ? (
        <SegmentedControl
          label={t('sell_through.month')}
          value={period}
          onChange={(value) => {
            setPeriod(value);
            setDrafts({});
            setSaved(false);
          }}
          choices={[
            { value: thisMonth, label: t('sell_through.this_month') },
            { value: lastMonth, label: t('sell_through.last_month') },
          ]}
        />
      ) : null}
      <Text tone="muted">{t('sell_through.carried')}</Text>
      {statement && statement.waiting > 0 ? (
        <Notice>{t('sell_through.waiting', { count: statement.waiting })}</Notice>
      ) : null}
      {saved ? <Notice tone="success">{t('sell_through.saved')}</Notice> : null}
      <TextField label={t('sell_through.search')} labelHidden value={q} onChangeText={setQ} />
      {accounts !== undefined && !account ? (
        <Text tone="muted">{t('account.gone')}</Text>
      ) : statement === undefined || items === undefined ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : shown.length === 0 ? (
        <EmptyState icon={PackageCheck} title={t('sell_through.no_items')}>
          {null}
        </EmptyState>
      ) : (
        shown.map((item) => {
          const line = statement.lines.get(item.id);
          const carried = statement.carried.get(item.id);
          const draft = drafts[item.id] ?? blank;
          const sent = sentFor(item.id, line);
          const live =
            sent && StockQuantity.safeParse(sent.closing).success
              ? lineFrom(sent, line, carried)
              : line;
          const opening = line?.opening ?? carried ?? '0';
          const set = (patch: Partial<Draft>) =>
            setDrafts((current) => ({
              ...current,
              [item.id]: { ...(current[item.id] ?? blank), ...patch },
            }));
          return (
            <Card key={item.id} style={styles.card}>
              <Text weight={600}>{item.name}</Text>
              <Text tone="muted">
                {item.code} · {t('sell_through.opening', { value: number(opening) })}
              </Text>
              <View style={styles.row}>
                <View style={styles.cell}>
                  <TextField
                    label={t('report.col_received')}
                    numeric
                    keyboardType="decimal-pad"
                    value={draft.received}
                    placeholder={line?.received ?? '0'}
                    onChangeText={(value) => set({ received: value })}
                  />
                </View>
                <View style={styles.cell}>
                  <TextField
                    label={t('report.col_returned')}
                    numeric
                    keyboardType="decimal-pad"
                    value={draft.returned}
                    placeholder={line?.returned ?? '0'}
                    onChangeText={(value) => set({ returned: value })}
                  />
                </View>
                <View style={styles.cell}>
                  <TextField
                    label={t('report.col_closing')}
                    numeric
                    keyboardType="decimal-pad"
                    value={draft.closing}
                    {...(line ? { placeholder: line.closing } : {})}
                    onChangeText={(value) => set({ closing: value })}
                  />
                </View>
              </View>
              {live ? (
                <View style={styles.row}>
                  <Text weight={600}>{t('sell_through.sold', { value: number(live.sold) })}</Text>
                  {live.flags.map((flag) => (
                    <Flag
                      key={flag}
                      tone={flag === 'negative_sold' ? 'danger' : 'waiting'}
                      label={t(`sell_through.flag_${flag}`)}
                    />
                  ))}
                </View>
              ) : null}
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
        label={t('sell_through.save')}
        variant="primary"
        disabled={busy || Object.keys(drafts).length === 0}
        onPress={() => void save()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.space2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2, alignItems: 'center' },
  cell: { flexGrow: 1, flexBasis: 90 },
});
