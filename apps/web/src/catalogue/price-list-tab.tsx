import { Link } from '@tanstack/react-router';
import { formatDate, formatMoney, formatNumber } from '@thelamp/i18n';
import type { ItemResult, PriceListEntry, PriceListResult } from '@thelamp/shared';
import { type Column, DataTable, EmptyState, Icon } from '@thelamp/ui-web';
import { Package } from 'lucide-react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useTerritories } from '../people/data';
import { usePriceListItems } from './data';

type Entry = PriceListEntry;

/**
 * One price list as a tab of the catalogue (decision D104): who it is for, when it is in force and
 * how many items it prices, then its prices beside each item's MRP, tax and HSN, with a way to
 * the list's own page to change it.
 */
export function PriceListTab({
  list,
  items,
  currency,
}: {
  list: PriceListResult;
  items: readonly ItemResult[];
  currency: string;
}) {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const config = useConfig(client, queryClient);
  const territories = useTerritories();
  const prices = usePriceListItems(list.id, '');
  const byId = new Map(items.map((item) => [item.id, item]));
  const money = (value: string) => formatMoney(value as `${number}`, { locale, currency });
  const day = (value: string) => formatDate(value, { locale });

  const named = (keys: readonly string[], names: Map<string, string>) =>
    keys.map((key) => names.get(key) ?? key).join(', ');
  const usedBy =
    list.scope === 'default'
      ? t('prices.scope_default')
      : list.scope === 'account_type'
        ? named(
            list.targets,
            new Map(
              (config.data?.bundle.accountTypes ?? []).map((type) => [
                type.key,
                type.name[locale].other,
              ]),
            ),
          )
        : list.scope === 'territory'
          ? named(
              list.targets,
              new Map((territories.data ?? []).map((node) => [node.id, node.name])),
            )
          : t('prices.scope_count', {
              scope: t(`prices.scope_${list.scope}`),
              count: list.targets.length,
            });

  const columns: Column<Entry>[] = [
    { key: 'code', header: t('catalogue.code'), render: (entry) => <code>{entry.item.code}</code> },
    {
      key: 'item',
      header: t('catalogue.item'),
      render: (entry) => <span className="font-semibold">{entry.item.name}</span>,
    },
    { key: 'pack', header: t('catalogue.pack'), render: (entry) => entry.item.packLabel ?? '—' },
    {
      key: 'mrp',
      header: t('catalogue.mrp'),
      align: 'end',
      render: (entry) => {
        const mrp = byId.get(entry.item.id)?.mrp;
        return mrp ? money(mrp) : '—';
      },
    },
    {
      key: 'price',
      header: t('catalogue.list_price'),
      align: 'end',
      render: (entry) => money(entry.price),
    },
    {
      key: 'rate',
      header: t('catalogue.net_rate'),
      align: 'end',
      render: (entry) => money(entry.rate),
    },
    {
      key: 'tax',
      header: t('catalogue.tax_rate'),
      align: 'end',
      render: (entry) =>
        `${formatNumber(entry.item.taxRate as `${number}`, { locale }, { maximumFractionDigits: 4 })}%`,
    },
    {
      key: 'hsn',
      header: t('catalogue.hsn'),
      render: (entry) => {
        const hsn = byId.get(entry.item.id)?.hsn;
        return hsn ? <code>{hsn}</code> : '—';
      },
    },
  ];

  const rows = prices.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-4">
        <div className="ks-card flex flex-col gap-1">
          <p className="ks-kpi-label">{t('catalogue.used_by')}</p>
          <p className="heading-md">{usedBy}</p>
        </div>
        <div className="ks-card flex flex-col gap-1">
          <p className="ks-kpi-label">{t('catalogue.in_force')}</p>
          <p className="heading-md">
            {list.validTo
              ? t('prices.between', { from: day(list.validFrom), to: day(list.validTo) })
              : t('catalogue.since', { date: day(list.validFrom) })}
          </p>
        </div>
        <div className="ks-card flex flex-col gap-1">
          <p className="ks-kpi-label">{t('prices.items')}</p>
          <p className="heading-md">{formatNumber(list.itemCount, { locale })}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="heading-md">{list.name}</h2>
        <Link
          to="/settings/price-lists/$priceListId"
          params={{ priceListId: list.id }}
          className="ks-btn secondary sm"
        >
          {t('catalogue.edit_list')}
        </Link>
      </div>
      {prices.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(prices.error, t)}
        </p>
      ) : prices.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('catalogue.list_caption', { list: list.name })}
          columns={columns}
          rows={rows}
          rowKey={(entry) => entry.item.id}
          empty={
            <EmptyState icon={<Icon icon={Package} />} title={t('catalogue.list_empty')}>
              {t('catalogue.list_empty_body')}
            </EmptyState>
          }
          {...(prices.hasNextPage
            ? {
                more: {
                  label: t('common.load_more'),
                  busy: prices.isFetchingNextPage,
                  onClick: () => void prices.fetchNextPage(),
                },
              }
            : {})}
        />
      )}
      <p className="ks-meta">{t('catalogue.prices_kept')}</p>
    </>
  );
}
