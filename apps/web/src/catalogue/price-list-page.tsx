import { formatMoney, formatNumber } from '@thelamp/i18n';
import {
  netRate,
  newId,
  PRICE_LIST_SCOPES,
  type PriceListEntry,
  type PriceListResult,
  type PriceListScope,
  todayIn,
} from '@thelamp/shared';
import {
  Button,
  Checkbox,
  ChoiceGroup,
  type Column,
  Confirm,
  DataTable,
  EmptyState,
  Icon,
  SelectField,
  TextField,
} from '@thelamp/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { Pencil, Save, Tags, Trash2, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useAccountOverview, useAccounts } from '../accounts/data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess, useTerritories } from '../people/data';
import { fieldErrors, PageHeader, Section } from '../people/shared';
import { useTypeList } from '../settings/types-data';
import { useCatalogue, useCatalogueWrites, usePriceList, usePriceListItems } from './data';

interface ListDraft {
  name: string;
  scope: PriceListScope;
  targets: string[];
  priority: string;
  validFrom: string;
  validTo: string;
  active: boolean;
}

/** A decimal string typed by a person is one the pricing functions can read. */
const DECIMAL = /^\d+(?:\.\d+)?$/;

/**
 * One price list (spec 5.11, decision D77): its name, who it is for, its priority and dates, and
 * the price per base unit and discount of each item on it, with the net rate each gives (BR-10).
 * Every change is made at the version the editor saw.
 */
export function PriceListPage({ priceListId }: { priceListId?: string }) {
  const { t } = useLanguage();
  const list = usePriceList(priceListId);
  if (priceListId && list.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(list.error, t)}
      </p>
    );
  }
  if (priceListId && !list.data) return <p className="ks-muted">{t('common.loading')}</p>;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={list.data ? list.data.name : t('prices.new_list')}
        back={{ to: '/settings/price-lists', label: t('prices.title') }}
      />
      <ListSettings key={list.data?.version ?? 'new'} list={list.data} />
      {list.data ? <Prices list={list.data} /> : null}
    </div>
  );
}

function ListSettings({ list }: { list: PriceListResult | undefined }) {
  const { t } = useLanguage();
  const access = useAccess();
  const navigate = useNavigate();
  const writes = useCatalogueWrites();
  const [id] = useState(() => list?.id ?? newId());
  const [draft, setDraft] = useState<ListDraft>(() => ({
    name: list?.name ?? '',
    scope: list?.scope ?? 'default',
    targets: [...(list?.targets ?? [])],
    priority: String(list?.priority ?? 0),
    validFrom: list?.validFrom ?? todayIn(access.timezone),
    validTo: list?.validTo ?? '',
    active: list?.active ?? true,
  }));
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const errors = fieldErrors(failure);
  const at = (path: string) => (errors[path] ? { error: errors[path] } : {});
  const set = <K extends keyof ListDraft>(key: K, value: ListDraft[K]) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      await writes.saveList(id, {
        name: draft.name.trim(),
        scope: draft.scope,
        targets: draft.scope === 'default' ? [] : draft.targets,
        priority: Number(draft.priority) || 0,
        validFrom: draft.validFrom,
        validTo: draft.validTo || null,
        active: draft.active,
        ...(list ? { version: list.version } : {}),
      });
      if (list) setSaved(true);
      else
        await navigate({
          to: '/settings/price-lists/$priceListId',
          params: { priceListId: id },
        });
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const targetIssue = Object.entries(errors).find(([path]) => path.startsWith('targets'))?.[1];
  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <Section title={t('prices.settings')}>
        {failure && Object.keys(errors).length === 0 ? (
          <p className="ks-help error" role="alert">
            {errorMessage(failure, t)}
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label={t('prices.name')}
            required
            value={draft.name}
            {...at('name')}
            onChange={(event) => set('name', event.target.value)}
          />
          <SelectField
            label={t('prices.for')}
            value={draft.scope}
            options={PRICE_LIST_SCOPES.map((scope) => ({
              value: scope,
              label: t(`prices.scope_${scope}`),
            }))}
            {...at('scope')}
            onChange={(event) => {
              set('scope', event.target.value as PriceListScope);
              set('targets', []);
            }}
          />
        </div>
        {draft.scope === 'default' ? (
          <p className="ks-muted">{t('prices.default_help')}</p>
        ) : (
          <Targets
            scope={draft.scope}
            value={draft.targets}
            {...(targetIssue ? { error: targetIssue } : {})}
            onChange={(targets) => set('targets', targets)}
          />
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <TextField
            label={t('prices.priority')}
            help={t('prices.priority_help')}
            numeric
            inputMode="numeric"
            value={draft.priority}
            {...at('priority')}
            onChange={(event) => set('priority', event.target.value)}
          />
          <TextField
            label={t('prices.valid_from')}
            type="date"
            required
            value={draft.validFrom}
            {...at('validFrom')}
            onChange={(event) => set('validFrom', event.target.value)}
          />
          <TextField
            label={t('prices.valid_to')}
            help={t('prices.valid_to_help')}
            type="date"
            value={draft.validTo}
            {...at('validTo')}
            onChange={(event) => set('validTo', event.target.value)}
          />
        </div>
        <Checkbox
          label={t('catalogue.active')}
          checked={draft.active}
          onChange={(event) => set('active', event.target.checked)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
            {list ? t('common.save') : t('prices.add_list')}
          </Button>
          {saved ? (
            <p className="ks-muted" role="status">
              {t('prices.saved')}
            </p>
          ) : null}
        </div>
      </Section>
    </form>
  );
}

/** Who a list is for: account types, segments, territories or accounts, by scope. */
function Targets({
  scope,
  value,
  error,
  onChange,
}: {
  scope: Exclude<PriceListScope, 'default'>;
  value: string[];
  error?: string;
  onChange: (targets: string[]) => void;
}) {
  const { t, locale } = useLanguage();
  const types = useTypeList();
  const territories = useTerritories();
  const [filter, setFilter] = useState('');
  const toggle = (target: string, on: boolean) =>
    onChange(on ? [...value, target] : value.filter((entry) => entry !== target));
  const legend = t(`prices.choose_${scope}`);

  if (scope === 'account') {
    return (
      <AccountTargets
        value={value}
        onChange={onChange}
        legend={legend}
        {...(error ? { error } : {})}
      />
    );
  }
  const options =
    scope === 'account_type'
      ? (types.data ?? []).map((type) => ({ value: type.key, label: type.name[locale].other }))
      : scope === 'segment'
        ? [
            ...new Map(
              (types.data ?? []).flatMap((type) =>
                type.segmentRules.map((rule) => [
                  rule.segment,
                  { value: rule.segment, label: rule.name[locale] },
                ]),
              ),
            ).values(),
          ]
        : (territories.data ?? [])
            .filter((node) => node.active)
            .map((node) => ({ value: node.id, label: `${node.name} (${node.code})` }));
  const needle = filter.trim().toLowerCase();
  const shown = options.filter(
    (option) =>
      value.includes(option.value) || !needle || option.label.toLowerCase().includes(needle),
  );
  return (
    <ChoiceGroup legend={legend} {...(error ? { error } : {})}>
      {scope === 'territory' ? (
        <TextField
          label={t('prices.find_territory')}
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {shown.slice(0, 60).map((option) => (
          <Checkbox
            key={option.value}
            label={option.label}
            checked={value.includes(option.value)}
            onChange={(event) => toggle(option.value, event.target.checked)}
          />
        ))}
      </div>
    </ChoiceGroup>
  );
}

/** Single accounts, found by type and part of a name or code. */
function AccountTargets({
  value,
  legend,
  error,
  onChange,
}: {
  value: string[];
  legend: string;
  error?: string;
  onChange: (targets: string[]) => void;
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
    <ChoiceGroup legend={legend} {...(error ? { error } : {})}>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('prices.chosen')}>
          {value.map((id) => (
            <li key={id}>
              <ChosenAccount
                id={id}
                onRemove={() => onChange(value.filter((entry) => entry !== id))}
              />
            </li>
          ))}
        </ul>
      ) : null}
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
      <div className="flex flex-col gap-1">
        {results
          .filter((account) => !value.includes(account.id))
          .map((account) => (
            <Checkbox
              key={account.id}
              label={`${account.name} (${account.code})`}
              checked={false}
              onChange={() => onChange([...value, account.id])}
            />
          ))}
      </div>
    </ChoiceGroup>
  );
}

function ChosenAccount({ id, onRemove }: { id: string; onRemove: () => void }) {
  const { t } = useLanguage();
  const account = useAccountOverview(id);
  const name = account.data
    ? `${account.data.account.name} (${account.data.account.code})`
    : t('common.loading');
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<Icon icon={X} />}
      aria-label={t('prices.unchoose', { name })}
      onClick={onRemove}
    >
      {name}
    </Button>
  );
}

/** The list's prices: find, add or change one, and remove one after asking. */
function Prices({ list }: { list: PriceListResult }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const catalogue = useCatalogue();
  const writes = useCatalogueWrites();
  const [q, setQ] = useState('');
  const entries = usePriceListItems(list.id, q.trim());
  const rows = entries.data?.pages.flatMap((page) => page.items) ?? [];
  const [itemId, setItemId] = useState('');
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [removing, setRemoving] = useState<PriceListEntry>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errors = fieldErrors(failure);
  const at = (path: string) => (errors[path] ? { error: errors[path] } : {});
  const money = (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: access.currency });
  const preview =
    DECIMAL.test(price.trim()) && (discount.trim() === '' || DECIMAL.test(discount.trim()))
      ? (() => {
          try {
            return netRate(price.trim(), discount.trim() || '0');
          } catch {
            return null;
          }
        })()
      : null;

  async function change(body: Parameters<typeof writes.setPrices>[1]) {
    setBusy(true);
    setFailure(undefined);
    try {
      await writes.setPrices(list.id, body);
      return true;
    } catch (caught) {
      setFailure(caught);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const done = await change({
      set: [{ itemId, price: price.trim(), discount: discount.trim() || '0' }],
      version: list.version,
    });
    if (done) {
      setItemId('');
      setPrice('');
      setDiscount('');
    }
  }

  const columns: Column<PriceListEntry>[] = [
    {
      key: 'item',
      header: t('catalogue.item'),
      render: (entry) => (
        <span className="flex flex-col">
          <span className="font-semibold">{entry.item.name}</span>
          <code>{entry.item.code}</code>
        </span>
      ),
    },
    {
      key: 'price',
      header: t('prices.price'),
      align: 'end',
      render: (entry) => money(entry.price),
    },
    {
      key: 'discount',
      header: t('prices.discount'),
      align: 'end',
      render: (entry) =>
        `${formatNumber(entry.discount as `${number}`, { locale }, { maximumFractionDigits: 4 })}%`,
    },
    {
      key: 'rate',
      header: t('prices.rate'),
      align: 'end',
      render: (entry) => money(entry.rate),
    },
    {
      key: 'actions',
      header: t('prices.actions'),
      render: (entry) => (
        <span className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon icon={Pencil} />}
            aria-label={t('prices.change_one', { item: entry.item.name })}
            onClick={() => {
              setItemId(entry.item.id);
              setPrice(String(Number(entry.price)));
              setDiscount(String(Number(entry.discount)));
            }}
          >
            {t('prices.change')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon icon={Trash2} />}
            aria-label={t('prices.remove_one', { item: entry.item.name })}
            onClick={() => setRemoving(entry)}
          >
            {t('prices.remove')}
          </Button>
        </span>
      ),
    },
  ];

  const items = (catalogue.data?.items ?? []).filter((item) => item.active);
  return (
    <Section title={t('prices.prices')}>
      <p className="ks-muted">{t('prices.prices_help')}</p>
      <form
        className="grid items-start gap-4 md:grid-cols-4"
        noValidate
        aria-label={t('prices.set_price')}
        onSubmit={(event) => void save(event)}
      >
        <SelectField
          label={t('catalogue.item')}
          none={t('prices.choose_item')}
          value={itemId}
          options={items.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }))}
          {...at('set.0.itemId')}
          onChange={(event) => setItemId(event.target.value)}
        />
        <TextField
          label={t('prices.price_per_unit')}
          numeric
          inputMode="decimal"
          value={price}
          {...at('set.0.price')}
          onChange={(event) => setPrice(event.target.value)}
        />
        <TextField
          label={t('prices.discount_percent')}
          numeric
          inputMode="decimal"
          value={discount}
          {...at('set.0.discount')}
          onChange={(event) => setDiscount(event.target.value)}
          help={preview ? t('prices.gives', { rate: money(preview) }) : undefined}
        />
        <div className="md:pt-7">
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={!itemId || !price.trim()}
            icon={<Icon icon={Save} />}
          >
            {t('prices.set_price')}
          </Button>
        </div>
      </form>
      {failure && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {removing ? (
        <Confirm
          question={t('prices.remove_question', { item: removing.item.name })}
          action={
            <Button
              variant="danger"
              busy={busy}
              onClick={() =>
                void change({ remove: [removing.item.id], version: list.version }).then((done) => {
                  if (done) setRemoving(undefined);
                })
              }
            >
              {t('prices.remove')}
            </Button>
          }
          cancel={
            <Button variant="secondary" onClick={() => setRemoving(undefined)}>
              {t('common.cancel')}
            </Button>
          }
        >
          <p>{t('prices.remove_body')}</p>
        </Confirm>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2" role="search">
        <TextField
          label={t('prices.find_item')}
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>
      {entries.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(entries.error, t)}
        </p>
      ) : entries.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('prices.prices_caption', { name: list.name })}
          columns={columns}
          rows={rows}
          rowKey={(entry) => entry.item.id}
          empty={
            <EmptyState icon={<Icon icon={Tags} />} title={t('prices.no_prices')}>
              {t('prices.no_prices_body')}
            </EmptyState>
          }
          {...(entries.hasNextPage
            ? {
                more: {
                  label: t('common.load_more'),
                  busy: entries.isFetchingNextPage,
                  onClick: () => void entries.fetchNextPage(),
                },
              }
            : {})}
        />
      )}
    </Section>
  );
}
