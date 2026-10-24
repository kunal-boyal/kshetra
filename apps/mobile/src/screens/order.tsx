import { spacing } from '@thelamp/design-tokens';
import { formatMoney, formatNumber } from '@thelamp/i18n';
import { gstHalves, OrderResult, orderSizeIssue, orderTotals } from '@thelamp/shared';
import {
  Button,
  Card,
  ChoiceGroup,
  EmptyState,
  ListGroup,
  ListRow,
  Notice,
  Screen,
  Text,
  TextField,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, Plus, Send, ShoppingCart, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { useFix } from '../location';
import { type CartLine, orderBody, priceCart, queueOrder } from '../orders';
import { type ItemPrice, useAccountPrices } from '../prices';
import { overCredit, useBalance } from '../finance';
import { useSync } from '../sync';

const QUANTITY = /^\d{1,12}(?:\.\d{1,3})?$/;

/**
 * `/order/<accountId>`: taking an order at an account (M10, spec 8.1, decision D78). Items come
 * from the price lists the phone keeps for the account, each line priced as the server will price
 * it; placing it attaches a fix and the open visit there, and queues it to send, offline too
 * unless the tenant says orders need a connection.
 */
export function OrderScreen({ accountId }: { accountId: string }) {
  const { t, locale } = useLanguage();
  const { client } = useApp();
  const sync = useSync();
  const config = useConfig();
  const accounts = useLocalRows('accounts');
  const account = accounts?.find((entry) => entry.id === accountId);
  const offers = useAccountPrices(account);
  const fix = useFix();
  const balance = useBalance(accountId);
  const bundle = config.data?.bundle;
  const rounding = bundle?.catalogue?.rounding ?? 'per_unit_first';
  const offline = bundle?.settings.ordersAllowedOffline ?? true;
  const currency = bundle?.settings.currency ?? 'INR';
  const [q, setQ] = useState('');
  const [choosing, setChoosing] = useState<ItemPrice>();
  const [unitKey, setUnitKey] = useState('');
  const [quantity, setQuantity] = useState('');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const money = (amount: string) => formatMoney(amount as `${number}`, { locale, currency });
  const number = (amount: string) =>
    formatNumber(amount as `${number}`, { locale }, { maximumFractionDigits: 3 });
  const unitName = (key: string) =>
    bundle?.catalogue?.units.find((unit) => unit.key === key)?.name[locale].one ?? key;

  const priced = priceCart(lines, offers ?? [], rounding);
  const totals = orderTotals(priced.map((line) => line.values));
  const halves = gstHalves(totals.tax);
  const tooLarge =
    orderSizeIssue(priced.map((line) => ({ itemId: line.itemId, total: line.values.total }))) ===
    'too_large';
  const needle = q.trim().toLowerCase();
  const shown = (offers ?? []).filter(
    ({ item }) =>
      !needle ||
      item.name.toLowerCase().includes(needle) ||
      item.code.toLowerCase().includes(needle),
  );

  function add() {
    if (!choosing || !QUANTITY.test(quantity.trim()) || Number(quantity) <= 0) return;
    const unit = unitKey || choosing.item.baseUnit;
    // BR-13: an item appears on one line; adding it again sets its quantity in the new unit.
    setLines((current) => [
      ...current.filter((line) => line.itemId !== choosing.item.id),
      { itemId: choosing.item.id, unitKey: unit, quantity: quantity.trim() },
    ]);
    setChoosing(undefined);
    setUnitKey('');
    setQuantity('');
  }

  async function place() {
    if (!sync || !client.owner || fix.status !== 'ready' || !account) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const body = await orderBody(sync, client.owner, {
        accountId: account.id,
        lines: priced,
        note,
        fix: fix.fix,
      });
      if (offline) {
        await queueOrder(sync, client.owner, body);
        await sync.runner.refresh();
        // It goes now if the phone has a connection, and with the next sync if not.
        void sync.runner.sync();
      } else {
        await client.request('POST', '/v1/orders', OrderResult, { body });
      }
      router.back();
    } catch (error) {
      setFailure(errorMessage(error, t));
      setBusy(false);
    }
  }

  if (accounts !== undefined && !account) {
    return (
      <Screen>
        <Back />
        <Text tone="muted">{t('account.gone')}</Text>
      </Screen>
    );
  }
  return (
    <Screen>
      <Back />
      <Text variant="headingXl" role="heading">
        {t('orders.at', { name: account?.name ?? '' })}
      </Text>
      {offers === undefined ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : offers.length === 0 ? (
        <EmptyState icon={ShoppingCart} title={t('prices.none_title')}>
          {t('prices.none_body')}
        </EmptyState>
      ) : (
        <>
          {choosing ? (
            <Card style={styles.stack}>
              <Text variant="headingMd">{choosing.item.name}</Text>
              <Text tone="muted">
                {t('orders.rate_per', {
                  rate: money(choosing.rate),
                  unit: unitName(choosing.item.baseUnit),
                })}
              </Text>
              {choosing.item.units.length > 1 ? (
                <ChoiceGroup
                  title={t('orders.unit')}
                  value={unitKey || choosing.item.baseUnit}
                  choices={choosing.item.units.map((unit) => ({
                    value: unit.key,
                    label: unitName(unit.key),
                    ...(unit.key === choosing.item.baseUnit
                      ? {}
                      : {
                          detail: t('orders.holds', {
                            count: number(unit.factor),
                            unit: unitName(choosing.item.baseUnit),
                          }),
                        }),
                  }))}
                  onChange={setUnitKey}
                />
              ) : null}
              <TextField
                label={t('orders.quantity')}
                keyboardType="decimal-pad"
                value={quantity}
                onChangeText={setQuantity}
              />
              <View style={styles.row}>
                <Button
                  variant="primary"
                  icon={Plus}
                  label={t('orders.add_line')}
                  disabled={!QUANTITY.test(quantity.trim()) || Number(quantity) <= 0}
                  onPress={add}
                />
                <Button
                  variant="ghost"
                  label={t('common.cancel')}
                  onPress={() => setChoosing(undefined)}
                />
              </View>
            </Card>
          ) : (
            <>
              <TextField label={t('prices.find_item')} value={q} onChangeText={setQ} />
              <ListGroup title={t('orders.items_here')}>
                {shown.map((offer) => (
                  <ListRow
                    key={offer.item.id}
                    label={`${offer.item.name} · ${money(offer.rate)}`}
                    detail={offer.item.code}
                    onPress={() => setChoosing(offer)}
                  />
                ))}
              </ListGroup>
            </>
          )}

          {priced.length > 0 ? (
            <ListGroup title={t('orders.in_order', { count: priced.length })}>
              {priced.map((line) => (
                <View key={line.itemId} style={styles.line}>
                  <View style={styles.grow}>
                    <ListRow
                      label={`${line.offer.item.name} · ${money(line.values.total)}`}
                      detail={t('orders.line_detail', {
                        quantity: number(line.quantity),
                        unit: unitName(line.unitKey),
                        base: number(line.values.baseUnits),
                      })}
                    />
                  </View>
                  <Button
                    variant="ghost"
                    icon={Trash2}
                    label={t('prices.remove')}
                    accessibilityLabel={t('orders.remove_line', { item: line.offer.item.name })}
                    onPress={() =>
                      setLines((current) => current.filter((entry) => entry.itemId !== line.itemId))
                    }
                  />
                </View>
              ))}
            </ListGroup>
          ) : null}

          {priced.length > 0 ? (
            <Card style={styles.stack}>
              <Text>{`${t('orders.taxable')}: ${money(totals.taxable)}`}</Text>
              <Text>{`${t('orders.cgst')}: ${money(halves.cgst)}`}</Text>
              <Text>{`${t('orders.sgst')}: ${money(halves.sgst)}`}</Text>
              <Text variant="headingMd">{`${t('orders.total')}: ${money(totals.total)}`}</Text>
              {tooLarge ? (
                <Text tone="danger" role="alert">
                  {t('orders.too_large')}
                </Text>
              ) : null}
              <TextField label={t('orders.note')} multiline value={note} onChangeText={setNote} />
              {fix.status === 'denied' || fix.status === 'unavailable' ? (
                <Notice>{t('orders.needs_fix')}</Notice>
              ) : null}
              {overCredit(balance, totals.total) ? (
                <Notice>{t('orders.over_credit')}</Notice>
              ) : null}
              {!offline ? <Notice>{t('orders.needs_connection')}</Notice> : null}
              {failure ? (
                <Text tone="danger" role="alert">
                  {failure}
                </Text>
              ) : null}
              <Button
                variant="primary"
                icon={Send}
                label={t('orders.place')}
                busy={busy || fix.status === 'locating'}
                disabled={tooLarge || fix.status !== 'ready'}
                onPress={() => void place()}
              />
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Back() {
  const { t } = useLanguage();
  return (
    <Button
      variant="ghost"
      icon={ArrowLeft}
      label={t('common.back')}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/accounts'))}
    />
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.space1 },
  grow: { flex: 1 },
});
