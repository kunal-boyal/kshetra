import { formatDate, formatNumber } from '@thelamp/i18n';
import type { PriceListResult } from '@thelamp/shared';
import { Button, type Column, DataTable, EmptyState, Icon, StatusBadge } from '@thelamp/ui-web';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, Tags } from 'lucide-react';
import { errorMessage, useLanguage } from '../i18n';
import { PageHeader } from '../people/shared';
import { usePriceLists } from './data';

/**
 * Price lists (spec 5.11, decision D77): the default list and the lists for account types,
 * segments, territories or single accounts, with the dates they apply on and how many items each
 * prices. The most specific list that applies prices an item; ties go to the higher priority.
 */
export function PriceListsPage() {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const lists = usePriceLists();

  const columns: Column<PriceListResult>[] = [
    {
      key: 'name',
      header: t('prices.list'),
      render: (list) => (
        <Link
          to="/settings/price-lists/$priceListId"
          params={{ priceListId: list.id }}
          className="font-semibold"
        >
          {list.name}
        </Link>
      ),
    },
    {
      key: 'scope',
      header: t('prices.for'),
      render: (list) =>
        list.scope === 'default'
          ? t('prices.scope_default')
          : t('prices.scope_count', {
              scope: t(`prices.scope_${list.scope}`),
              count: list.targets.length,
            }),
    },
    {
      key: 'dates',
      header: t('prices.dates'),
      render: (list) =>
        list.validTo
          ? t('prices.between', {
              from: formatDate(list.validFrom, { locale }),
              to: formatDate(list.validTo, { locale }),
            })
          : t('prices.from', { from: formatDate(list.validFrom, { locale }) }),
    },
    {
      key: 'priority',
      header: t('prices.priority'),
      align: 'end',
      render: (list) => formatNumber(list.priority, { locale }),
    },
    {
      key: 'items',
      header: t('prices.items'),
      align: 'end',
      render: (list) => formatNumber(list.itemCount, { locale }),
    },
    {
      key: 'status',
      header: t('catalogue.status'),
      render: (list) => (
        <StatusBadge variant={list.active ? 'success' : 'neutral'}>
          {t(list.active ? 'catalogue.active' : 'catalogue.inactive')}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('prices.title')} intro={t('prices.intro')}>
        <Button
          variant="primary"
          icon={<Icon icon={Plus} />}
          onClick={() => void navigate({ to: '/settings/price-lists/new' })}
        >
          {t('prices.add_list')}
        </Button>
      </PageHeader>
      {lists.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(lists.error, t)}
        </p>
      ) : lists.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('prices.caption')}
          columns={columns}
          rows={lists.data}
          rowKey={(list) => list.id}
          empty={
            <EmptyState icon={<Icon icon={Tags} />} title={t('prices.empty_title')}>
              {t('prices.empty_body')}
            </EmptyState>
          }
        />
      )}
    </div>
  );
}
