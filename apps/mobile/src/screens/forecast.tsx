import { spacing } from '@thelamp/design-tokens';
import { formatMonth, formatNumber } from '@thelamp/i18n';
import {
  FORECAST_MONTHS,
  forecastOpen,
  shiftPeriod,
  StockQuantity,
  todayIn,
} from '@thelamp/shared';
import {
  Button,
  Card,
  ChipGroup,
  EmptyState,
  Notice,
  Screen,
  StatusBadge,
  Text,
  TextField,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, ChartLine } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useApp } from '../app-state';
import { useConfig } from '../data';
import { queueForecast, useForecast } from '../forecasts';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { useSync } from '../sync';

/** A typed quantity, without the separators people type. */
const typed = (value: string) => value.trim().replace(/,/g, '');

/**
 * `/forecast/<accountId>`: an account's forecast by item (BR-54, decision D126). The next three
 * months are open: the person types each item's expected quantity, 0 to take one out, and saves
 * offline as a new version. This month is locked and shown as it stands; a manager changes a
 * locked month on the portal, with a reason.
 */
export function ForecastScreen({ accountId }: { accountId: string }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const sync = useSync();
  const config = useConfig();
  const accounts = useLocalRows('accounts');
  const items = useLocalRows('items');
  const account = accounts?.find((entry) => entry.id === accountId);
  const today = todayIn(config.data?.bundle.settings.timezone ?? 'Asia/Kolkata');
  const thisMonth = today.slice(0, 7);
  const months = Array.from({ length: FORECAST_MONTHS + 1 }, (_, index) =>
    shiftPeriod(thisMonth, index),
  );
  const [period, setPeriod] = useState(() => shiftPeriod(thisMonth, 1));
  const forecast = useForecast(accountId, period);
  const open = forecastOpen(period, today, false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const number = (value: string) => formatNumber(Number(value), { locale });

  async function save() {
    if (!sync || !client.owner) return;
    setError(undefined);
    setSaved(false);
    const lines = Object.entries(drafts)
      .filter(([, value]) => typed(value) !== '')
      .map(([itemId, value]) => ({ itemId, quantity: typed(value) }));
    if (lines.length === 0) {
      setError(t('forecast.nothing_changed'));
      return;
    }
    if (lines.some((line) => !StockQuantity.safeParse(line.quantity).success)) {
      setError(t('forecast.quantity_issue'));
      return;
    }
    setBusy(true);
    try {
      await queueForecast(sync, client.owner, accountId, period, lines);
      setDrafts({});
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  const needle = q.trim().toLowerCase();
  const forecastFirst = (itemId: string) => (forecast?.quantities.has(itemId) ? 0 : 1);
  const shown = (items ?? [])
    .filter((item) => item.active)
    // A locked month shows only what it holds.
    .filter((item) => open || forecast?.quantities.has(item.id))
    .filter(
      (item) =>
        !needle ||
        item.name.toLowerCase().includes(needle) ||
        item.code.toLowerCase().includes(needle),
    )
    .sort((a, b) => forecastFirst(a.id) - forecastFirst(b.id) || a.name.localeCompare(b.name));

  return (
    <Screen>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/accounts'))}
      />
      <Text variant="headingXl" role="heading">
        {t('forecast.at', { name: account?.name ?? '' })}
      </Text>
      <ChipGroup
        label={t('forecast.month')}
        value={period}
        onChange={(value) => {
          setPeriod(value);
          setDrafts({});
          setSaved(false);
          setError(undefined);
        }}
        choices={months.map((month) => ({ value: month, label: formatMonth(month, { locale }) }))}
      />
      <StatusBadge
        variant={open ? 'info' : 'neutral'}
        label={open ? t('forecast.month_open') : t('forecast.month_locked')}
      />
      {!open ? <Text tone="muted">{t('forecast.locked_phone')}</Text> : null}
      {forecast && forecast.waiting > 0 ? (
        <Notice>{t('forecast.waiting', { count: forecast.waiting })}</Notice>
      ) : null}
      {saved ? <Notice tone="success">{t('forecast.saved_phone')}</Notice> : null}
      {open ? (
        <TextField label={t('forecast.search')} labelHidden value={q} onChangeText={setQ} />
      ) : null}
      {accounts !== undefined && !account ? (
        <Text tone="muted">{t('account.gone')}</Text>
      ) : forecast === undefined || items === undefined ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : shown.length === 0 ? (
        <EmptyState icon={ChartLine} title={t(open ? 'forecast.no_items' : 'forecast.none')}>
          {null}
        </EmptyState>
      ) : (
        shown.map((item) => {
          const current = forecast.quantities.get(item.id);
          return (
            <Card key={item.id} style={styles.card}>
              <Text weight={600}>{item.name}</Text>
              <Text tone="muted">
                {item.code}
                {current ? ` · ${number(current)} ${item.baseUnit}` : ''}
              </Text>
              {open ? (
                <TextField
                  label={t('forecast.quantity_of', { name: item.name })}
                  labelHidden
                  numeric
                  keyboardType="decimal-pad"
                  value={drafts[item.id] ?? ''}
                  placeholder={current ?? '0'}
                  onChangeText={(value) =>
                    setDrafts((existing) => ({ ...existing, [item.id]: value }))
                  }
                />
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
      {open ? (
        <Button
          label={t('forecast.save')}
          variant="primary"
          disabled={busy || Object.values(drafts).every((value) => typed(value) === '')}
          onPress={() => void save()}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.space2 },
});
