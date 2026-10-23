import { ApiError } from '@thelamp/api-client';
import { formatMoney, formatNumber } from '@thelamp/i18n';
import {
  gstHalves,
  newId,
  orderSizeIssue,
  orderTotals,
  priceLine,
  type PricedLine,
} from '@thelamp/shared';
import {
  Button,
  type Column,
  DataTable,
  Icon,
  SelectField,
  TextAreaField,
  TextField,
} from '@thelamp/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Send, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useAccounts } from '../accounts/data';
import { useCatalogue } from '../catalogue/data';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { Facts, PageHeader, Section } from '../people/shared';
import { useTypeList } from '../settings/types-data';
import { useAccountPrices, useOrderWrites } from './data';

interface DraftLine {
  itemId: string;
  unitKey: string;
  quantity: string;
}

const QUANTITY = /^\d{1,12}(?:\.\d{1,3})?$/;

/**
 * The order desk (M10, spec 8.2, decision D78): an order taken by phone or at the counter. Choose
 * the account, add items in any unit they are sold in, and see each line priced as the server will
 * price it, from the lists that apply to the account today; placing it sends what was shown, so
 * a price changed meanwhile is refused and shown again.
 */
export function OrderDeskPage() {
  const { t } = useLanguage();
  const [account, setAccount] = useState<{ id: string; name: string; code: string }>();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('orders.desk_title')}
        intro={t('orders.desk_intro')}
        back={{ to: '/orders', label: t('orders.title') }}
      />
      {account ? (
        <Cart account={account} onChange={() => setAccount(undefined)} />
      ) : (
        <AccountChoice onChoose={setAccount} />
      )}
    </div>
  );
}

function AccountChoice({
  onChoose,
}: {
  onChoose: (account: { id: string; name: string; code: string }) => void;
}) {
  const { t, locale } = useLanguage();
  const types = useTypeList();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const chosenType = type || types.data?.[0]?.key || '';
  const found = useAccounts(
    { type: chosenType, ...(q.trim() ? { q: q.trim() } : {}) },
    chosenType !== '' && q.trim().length > 0,
    20,
  );
  const results = found.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Section title={t('orders.choose_account')}>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label={t('prices.account_type')}
          value={chosenType}
          options={(types.data ?? []).map((entry) => ({
            value: entry.key,
            label: entry.name[locale].other,
          }))}
          onChange={(event) => setType(event.target.value)}
        />
        <TextField
          label={t('prices.find_account')}
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>
      <ul className="flex flex-col gap-2" aria-label={t('orders.accounts_found')}>
        {results.map((account) => (
          <li key={account.id}>
            <Button
              variant="secondary"
              onClick={() => onChoose({ id: account.id, name: account.name, code: account.code })}
            >
              {`${account.name} (${account.code})`}
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Cart({
  account,
  onChange,
}: {
  account: { id: string; name: string; code: string };
  onChange: () => void;
}) {
  const { t, locale } = useLanguage();
  const { client, queryClient } = useApp();
  const config = useConfig(client, queryClient);
  const access = useAccess();
  const navigate = useNavigate();
  const writes = useOrderWrites();
  const catalogue = useCatalogue();
  const prices = useAccountPrices(account.id);
  const rounding = config.data?.bundle.catalogue.rounding ?? 'per_unit_first';
  const [id] = useState(() => newId());
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [itemId, setItemId] = useState('');
  const [unitKey, setUnitKey] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [addIssue, setAddIssue] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const money = (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: access.currency });

  const items = new Map((catalogue.data?.items ?? []).map((item) => [item.id, item]));
  const priceOf = new Map((prices.data?.items ?? []).map((entry) => [entry.itemId, entry]));
  const offered = [...priceOf.keys()]
    .map((key) => items.get(key))
    .filter((item) => item?.active)
    .map((item) => item!)
    .sort((a, b) => a.name.localeCompare(b.name));
  const chosen = items.get(itemId);
  const priced = lines.flatMap((line) => {
    const item = items.get(line.itemId);
    const price = priceOf.get(line.itemId);
    const unit = item?.units.find((entry) => entry.key === line.unitKey);
    if (!item || !price || !unit) return [];
    return [
      {
        line,
        item,
        price,
        unit,
        priced: priceLine(
          {
            price: price.price,
            discount: price.discount,
            taxRate: item.taxRate,
            quantity: line.quantity,
            factor: unit.factor,
            measurePerBaseUnit: item.measurePerBaseUnit,
          },
          rounding,
        ),
      },
    ];
  });
  const totals = orderTotals(priced.map((entry) => entry.priced));
  const halves = gstHalves(totals.tax);
  const tooLarge =
    orderSizeIssue(
      priced.map((entry) => ({ itemId: entry.item.id, total: entry.priced.total })),
    ) === 'too_large';

  function add(event: FormEvent) {
    event.preventDefault();
    if (!chosen || !QUANTITY.test(quantity.trim()) || Number(quantity) <= 0) return;
    const unit = unitKey || chosen.baseUnit;
    // BR-13: an item appears on one line, in one unit.
    if (lines.some((line) => line.itemId === chosen.id && line.unitKey !== unit)) {
      setAddIssue(t('orders.one_line'));
      return;
    }
    setAddIssue(undefined);
    setLines((current) => {
      const same = current.find((line) => line.itemId === chosen.id && line.unitKey === unit);
      // BR-13: an item appears on one line; adding it again adds to its quantity.
      if (same) {
        return current.map((line) =>
          line === same
            ? { ...line, quantity: String(Number(line.quantity) + Number(quantity.trim())) }
            : line,
        );
      }
      return [...current, { itemId: chosen.id, unitKey: unit, quantity: quantity.trim() }];
    });
    setItemId('');
    setUnitKey('');
    setQuantity('');
  }

  async function place() {
    setBusy(true);
    setFailure(undefined);
    try {
      await writes.place({
        id,
        accountId: account.id,
        lines: priced.map(({ line, item, price, unit }) => ({
          itemId: item.id,
          unitKey: line.unitKey,
          quantity: line.quantity,
          quoted: {
            listId: price.listId,
            price: price.price,
            discount: price.discount,
            taxRate: item.taxRate,
            factor: unit.factor,
          },
        })),
        note: note.trim() || null,
        placedAt: new Date().toISOString(),
      });
      await navigate({ to: '/orders/$orderId', params: { orderId: id } });
    } catch (caught) {
      setFailure(caught);
      setBusy(false);
      // Prices changed since they were shown: read them again, and show the lines anew.
      if (caught instanceof ApiError && caught.code === 'PRICE_CHANGED') void prices.refetch();
    }
  }

  const columns: Column<(typeof priced)[number]>[] = [
    {
      key: 'item',
      header: t('orders.item'),
      render: ({ item }) => (
        <span className="flex flex-col">
          <span className="font-semibold">{item.name}</span>
          <code>{item.code}</code>
        </span>
      ),
    },
    {
      key: 'quantity',
      header: t('orders.quantity'),
      align: 'end',
      render: ({ line, item, priced: values }) => (
        <span className="flex flex-col">
          <span>{`${formatNumber(line.quantity as `${number}`, { locale })} ${line.unitKey}`}</span>
          <span className="ks-muted">
            {t('orders.base_units', {
              count: formatNumber(values.baseUnits as `${number}`, { locale }),
              unit: item.baseUnit,
            })}
          </span>
        </span>
      ),
    },
    {
      key: 'rate',
      header: t('orders.rate'),
      align: 'end',
      render: ({ priced: v }) => money(v.rate),
    },
    {
      key: 'taxable',
      header: t('orders.taxable'),
      align: 'end',
      render: ({ priced: v }) => money(v.taxable),
    },
    { key: 'tax', header: t('orders.tax'), align: 'end', render: ({ priced: v }) => money(v.tax) },
    {
      key: 'total',
      header: t('orders.total'),
      align: 'end',
      render: ({ priced: v }: { priced: PricedLine }) => money(v.total),
    },
    {
      key: 'remove',
      header: t('prices.actions'),
      render: ({ item }) => (
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon icon={Trash2} />}
          aria-label={t('orders.remove_line', { item: item.name })}
          onClick={() => setLines((current) => current.filter((line) => line.itemId !== item.id))}
        >
          {t('prices.remove')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <Section title={t('orders.for_account', { name: account.name })}>
        <Facts items={[[t('orders.account'), `${account.name} (${account.code})`]]} />
        <div>
          <Button variant="secondary" size="sm" onClick={onChange}>
            {t('orders.change_account')}
          </Button>
        </div>
      </Section>
      <form
        className="ks-card grid items-start gap-4 md:grid-cols-4"
        noValidate
        aria-label={t('orders.add_line')}
        onSubmit={add}
      >
        <SelectField
          label={t('orders.item')}
          none={t('prices.choose_item')}
          value={itemId}
          options={offered.map((item) => ({
            value: item.id,
            label: `${item.name} (${item.code})`,
          }))}
          onChange={(event) => {
            setItemId(event.target.value);
            setUnitKey('');
          }}
        />
        <SelectField
          label={t('orders.unit')}
          value={unitKey || chosen?.baseUnit || ''}
          options={(chosen?.units ?? []).map((unit) => ({ value: unit.key, label: unit.key }))}
          disabled={!chosen}
          onChange={(event) => setUnitKey(event.target.value)}
        />
        <TextField
          label={t('orders.quantity')}
          numeric
          inputMode="decimal"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <div className="md:pt-7">
          <Button
            type="submit"
            variant="secondary"
            icon={<Icon icon={Plus} />}
            disabled={!chosen || !QUANTITY.test(quantity.trim()) || Number(quantity) <= 0}
          >
            {t('orders.add_line')}
          </Button>
        </div>
      </form>
      {addIssue ? (
        <p className="ks-help error" role="alert">
          {addIssue}
        </p>
      ) : null}
      {prices.data && offered.length === 0 ? (
        <p className="ks-muted">{t('prices.none_body')}</p>
      ) : null}
      <DataTable
        caption={t('orders.lines_caption')}
        columns={columns}
        rows={priced}
        rowKey={(entry) => entry.item.id}
        empty={<p className="ks-muted">{t('orders.no_lines')}</p>}
      />
      <Section title={t('orders.totals')}>
        <Facts
          items={[
            [t('orders.taxable'), money(totals.taxable)],
            [t('orders.cgst'), money(halves.cgst)],
            [t('orders.sgst'), money(halves.sgst)],
            [t('orders.total'), money(totals.total)],
          ]}
        />
        {tooLarge ? (
          <p className="ks-help error" role="alert">
            {t('orders.too_large')}
          </p>
        ) : null}
      </Section>
      <TextAreaField
        label={t('orders.note')}
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {failure ? (
        <p className="ks-help error" role="alert">
          {failure instanceof ApiError && failure.code === 'PRICE_CHANGED'
            ? t('orders.prices_changed')
            : errorMessage(failure, t)}
        </p>
      ) : null}
      <div>
        <Button
          variant="primary"
          busy={busy}
          disabled={priced.length === 0 || tooLarge}
          icon={<Icon icon={Send} />}
          onClick={() => void place()}
        >
          {t('orders.place')}
        </Button>
      </div>
    </>
  );
}
