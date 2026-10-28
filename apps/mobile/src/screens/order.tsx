import { radius, spacing } from '@thelamp/design-tokens';
import { formatMoney, formatNumber } from '@thelamp/i18n';
import {
  gstHalves,
  OrderResult,
  orderSizeIssue,
  orderTotals,
  scaled,
  unscaled,
} from '@thelamp/shared';
import {
  ActionBar,
  AppBar,
  Button,
  Card,
  CartBar,
  ChipGroup,
  ChoiceGroup,
  EmptyState,
  IconChip,
  ListGroup,
  ListRow,
  Notice,
  QuantityStepper,
  Screen,
  Text,
  TextField,
  useTheme,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import {
  CircleCheck,
  Package,
  Plus,
  Search,
  ShoppingCart,
  TriangleAlert,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../app-state';
import { useConfig } from '../data';
import { overCredit, useBalance } from '../finance';
import { errorMessage, useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { useFix } from '../location';
import { type CartLine, orderBody, priceCart, queueOrder, stepQuantity } from '../orders';
import { type ItemPrice, useAccountPrices } from '../prices';
import { useSync } from '../sync';
import { HUES } from './account';

const QUANTITY = /^\d{1,12}(?:\.\d{1,3})?$/;
const ALL = '';

/**
 * `/order/<accountId>`: taking an order at an account (M10, spec 8.1, decision D78), in two steps
 * as the prototype's AppOrder and AppOrderReview (D104). The items step finds items by name, code
 * and category and counts each with a stepper, the cart held at its foot; the review step shows
 * each line and the totals as the server will price them, says whether the order is within
 * credit, and places it with a fix and the open visit there, queued to send, offline too unless
 * the tenant says orders need a connection.
 */
export function OrderScreen({ accountId }: { accountId: string }) {
  const { t, locale } = useLanguage();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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
  const [step, setStep] = useState<'items' | 'review'>('items');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState(ALL);
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

  // Android's back button leaves the review for the items, keeping the cart. The web has none.
  useEffect(() => {
    if (step !== 'review' || Platform.OS === 'web') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      setStep('items');
      return true;
    });
    return () => listener.remove();
  }, [step]);

  const priced = priceCart(lines, offers ?? [], rounding);
  const totals = orderTotals(priced.map((line) => line.values));
  const halves = gstHalves(totals.tax);
  const tooLarge =
    orderSizeIssue(priced.map((line) => ({ itemId: line.itemId, total: line.values.total }))) ===
    'too_large';
  const categories = [
    ...new Map(
      (offers ?? []).flatMap(({ item }) =>
        item.category ? [[item.category.id, item.category]] : [],
      ),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const hueOf = (categoryId: string | undefined) =>
    HUES[(categories.findIndex((entry) => entry.id === categoryId) + 1) % HUES.length]!;
  const needle = q.trim().toLowerCase();
  const shown = (offers ?? []).filter(
    ({ item }) =>
      (category === ALL || item.category?.id === category) &&
      (!needle ||
        item.name.toLowerCase().includes(needle) ||
        item.code.toLowerCase().includes(needle)),
  );
  const lists = [...new Set((offers ?? []).map((offer) => offer.list.name))];
  const lineOf = (itemId: string) => lines.find((line) => line.itemId === itemId);

  function setLine(itemId: string, line: CartLine | null) {
    // BR-13: an item appears on one line.
    setLines((current) => {
      const others = current.filter((entry) => entry.itemId !== itemId);
      return line ? [...others, line] : others;
    });
  }

  function stepBy(offer: ItemPrice, by: 1 | -1) {
    const line = lineOf(offer.item.id);
    const next = stepQuantity(line?.quantity ?? '0', by);
    setLine(
      offer.item.id,
      next
        ? { itemId: offer.item.id, unitKey: line?.unitKey ?? offer.item.baseUnit, quantity: next }
        : null,
    );
  }

  function choose(offer: ItemPrice) {
    const line = lineOf(offer.item.id);
    setChoosing(offer);
    setUnitKey(line?.unitKey ?? '');
    setQuantity(line?.quantity ?? '');
  }

  function add() {
    if (!choosing || !QUANTITY.test(quantity.trim()) || Number(quantity) <= 0) return;
    setLine(choosing.item.id, {
      itemId: choosing.item.id,
      unitKey: unitKey || choosing.item.baseUnit,
      quantity: quantity.trim(),
    });
    setChoosing(undefined);
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

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/accounts'));

  if (accounts !== undefined && !account) {
    return (
      <Screen>
        <AppBar title={t('orders.take')} onBack={leave} backLabel={t('common.back')} />
        <Text tone="muted">{t('account.gone')}</Text>
      </Screen>
    );
  }

  if (step === 'review') {
    const limit = balance?.creditLimit ?? null;
    const over = overCredit(balance, totals.total);
    return (
      <Screen
        key="review"
        footer={
          <ActionBar>
            <View style={styles.grow}>
              <Button
                variant="primary"
                block
                label={t('orders.place_total', { total: money(totals.total) })}
                busy={busy || fix.status === 'locating'}
                disabled={tooLarge || fix.status !== 'ready' || priced.length === 0}
                onPress={() => void place()}
              />
            </View>
          </ActionBar>
        }
      >
        <AppBar
          title={t('orders.review_title')}
          subtitle={[account?.name, account?.code].filter(Boolean).join(' · ')}
          onBack={() => setStep('items')}
          backLabel={t('orders.back_to_items')}
        />
        <ListGroup>
          {priced.map((line) => {
            const values = {
              quantity: number(line.quantity),
              unit: unitName(line.unitKey),
              rate: money(line.values.rate),
              tax: `${formatNumber(line.offer.item.taxRate as `${number}`, { locale }, { maximumFractionDigits: 2 })}%`,
            };
            return (
              <ListRow
                key={line.itemId}
                label={line.offer.item.name}
                detail={
                  line.unitKey === line.offer.item.baseUnit
                    ? t('orders.review_line', values)
                    : t('orders.review_line_units', {
                        ...values,
                        base: number(line.values.baseUnits),
                        baseUnit: unitName(line.offer.item.baseUnit),
                      })
                }
                trailing={
                  <Text weight={600} style={styles.figure}>
                    {money(line.values.taxable)}
                  </Text>
                }
              />
            );
          })}
        </ListGroup>
        <Card style={styles.totals}>
          <Sum label={t('orders.subtotal')} value={money(totals.taxable)} />
          <Sum label={t('orders.cgst')} value={money(halves.cgst)} />
          <Sum label={t('orders.sgst')} value={money(halves.sgst)} />
          <View style={[styles.rule, { borderColor: theme.colors.border }]}>
            <Sum label={t('orders.total')} value={money(totals.total)} strong />
          </View>
        </Card>
        {over ? (
          <Notice tone="pending" icon={TriangleAlert}>
            {t('orders.over_credit')}
          </Notice>
        ) : balance && limit !== null ? (
          <Notice tone="success" icon={CircleCheck}>
            {t('orders.within_credit', {
              free: money(unscaled(scaled(limit, 2) - scaled(balance.outstanding, 2), 2)),
              limit: money(limit),
            })}
          </Notice>
        ) : null}
        {tooLarge ? (
          <Notice tone="danger" icon={TriangleAlert}>
            {t('orders.too_large')}
          </Notice>
        ) : null}
        {fix.status === 'denied' || fix.status === 'unavailable' ? (
          <Notice>{t('orders.needs_fix')}</Notice>
        ) : null}
        <TextField label={t('orders.note')} multiline value={note} onChangeText={setNote} />
        {offline ? (
          <Text variant="bodySm" tone="muted">
            {t('orders.waits_offline')}
          </Text>
        ) : (
          <Notice>{t('orders.needs_connection')}</Notice>
        )}
        {failure ? (
          <Text tone="danger" role="alert">
            {failure}
          </Text>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      key="items"
      footer={
        priced.length > 0 && !choosing ? (
          <View style={{ paddingBottom: insets.bottom }}>
            <CartBar
              count={t('orders.cart_items', { count: priced.length })}
              total={money(totals.taxable)}
              note={t('orders.plus_gst')}
              action={t('orders.review')}
              onPress={() => setStep('review')}
            />
          </View>
        ) : undefined
      }
    >
      <AppBar
        title={t('orders.take')}
        subtitle={[account?.name, lists.length === 1 ? lists[0] : null].filter(Boolean).join(' · ')}
        onBack={leave}
        backLabel={t('common.back')}
      />
      {offers === undefined ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : offers.length === 0 ? (
        <EmptyState icon={ShoppingCart} title={t('prices.none_title')}>
          {t('prices.none_body')}
        </EmptyState>
      ) : choosing ? (
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
          <View style={styles.stack}>
            <TextField
              label={t('orders.search')}
              icon={Search}
              labelHidden
              value={q}
              onChangeText={setQ}
            />
            {categories.length > 1 ? (
              <ChipGroup
                label={t('orders.categories')}
                value={category}
                onChange={setCategory}
                choices={[
                  { value: ALL, label: t('orders.all_items') },
                  ...categories.map((entry) => ({ value: entry.id, label: entry.name })),
                ]}
              />
            ) : null}
          </View>
          {shown.length === 0 ? (
            <Text tone="muted">{t('orders.no_match')}</Text>
          ) : (
            <ListGroup>
              {shown.map((offer) => {
                const line = lineOf(offer.item.id);
                const inOtherUnit = line && line.unitKey !== offer.item.baseUnit;
                return (
                  <ListRow
                    key={offer.item.id}
                    lead={<IconChip icon={Package} hue={hueOf(offer.item.category?.id)} />}
                    label={offer.item.name}
                    detail={[
                      offer.item.packLabel,
                      // The rate is for the base unit, which needs naming only beside others.
                      offer.item.units.length > 1
                        ? `${money(offer.rate)}/${unitName(offer.item.baseUnit)}`
                        : money(offer.rate),
                      inOtherUnit ? unitName(line.unitKey) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    trailing={
                      <QuantityStepper
                        value={number(line?.quantity ?? '0')}
                        valueLabel={t('orders.quantity_of', {
                          item: offer.item.name,
                          quantity: line
                            ? `${number(line.quantity)} ${unitName(line.unitKey)}`
                            : number('0'),
                        })}
                        lessLabel={t('orders.fewer', { item: offer.item.name })}
                        moreLabel={t('orders.more', { item: offer.item.name })}
                        onLess={() => stepBy(offer, -1)}
                        onMore={() => stepBy(offer, 1)}
                        onValue={() => choose(offer)}
                      />
                    }
                  />
                );
              })}
            </ListGroup>
          )}
        </>
      )}
    </Screen>
  );
}

/** A line of the totals: its name, and the amount at the end. */
function Sum({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.sum}>
      <Text variant={strong ? 'labelLg' : undefined} tone={strong ? undefined : 'muted'}>
        {label}
      </Text>
      <Text variant={strong ? 'headingMd' : undefined} style={styles.figure}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
  grow: { flex: 1 },
  totals: { gap: spacing.space2, borderRadius: radius.radiusLg },
  sum: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.space4 },
  rule: { borderTopWidth: 1, paddingTop: spacing.space2 },
  figure: { fontVariant: ['tabular-nums'], textAlign: 'right' },
});
