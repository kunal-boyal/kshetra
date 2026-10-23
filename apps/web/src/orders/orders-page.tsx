import { formatMoney, formatNumber } from '@thelamp/i18n';
import { ORDER_STATUSES, type OrderStatus, type OrderSummary } from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  type Column,
  DataTable,
  EmptyState,
  Icon,
  SelectField,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { PageHeader, useDates } from '../people/shared';
import { type OrderFilters, useOrders } from './data';

export const ORDER_BADGE: Record<OrderStatus, BadgeVariant> = {
  submitted: 'waiting',
  accepted: 'success',
  partially_accepted: 'pending',
  rejected: 'danger',
  fulfilled: 'success',
  partially_fulfilled: 'info',
  cancelled: 'neutral',
};

/**
 * The orders register (M10, spec 8.2, decision D78): the orders the viewer sees, newest first,
 * by status and dates, with their totals. An order opens its page; the order desk places one.
 */
export function OrdersPage() {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const [filters, setFilters] = useState<OrderFilters>({});
  const orders = useOrders(filters);
  const rows = orders.data?.pages.flatMap((page) => page.items) ?? [];
  const set = (patch: Partial<OrderFilters>) =>
    setFilters((current) => {
      const next = { ...current, ...patch };
      return Object.fromEntries(Object.entries(next).filter(([, value]) => value)) as OrderFilters;
    });

  const columns: Column<OrderSummary>[] = [
    {
      key: 'placed',
      header: t('orders.placed'),
      render: (order) => (
        <Link to="/orders/$orderId" params={{ orderId: order.id }} className="font-semibold">
          {dates.dateTime(order.placedAt)}
        </Link>
      ),
    },
    {
      key: 'account',
      header: t('orders.account'),
      render: (order) => (
        <span className="flex flex-col">
          <span>{order.account.name}</span>
          <code>{order.account.code}</code>
        </span>
      ),
    },
    { key: 'by', header: t('orders.placed_by'), render: (order) => order.placedBy.name },
    {
      key: 'lines',
      header: t('orders.lines'),
      align: 'end',
      render: (order) => formatNumber(order.lineCount, { locale }),
    },
    {
      key: 'total',
      header: t('orders.total'),
      align: 'end',
      render: (order) =>
        formatMoney(order.total as `${number}`, { locale, currency: access.currency }),
    },
    {
      key: 'status',
      header: t('orders.status'),
      render: (order) => (
        <StatusBadge variant={ORDER_BADGE[order.status]}>
          {t(`orders.status_${order.status}`)}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('orders.title')} intro={t('orders.intro')}>
        {access.can('order.create') ? (
          <Button
            variant="primary"
            icon={<Icon icon={Plus} />}
            onClick={() => void navigate({ to: '/orders/new' })}
          >
            {t('orders.new')}
          </Button>
        ) : null}
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-3" role="search">
        <SelectField
          label={t('orders.status')}
          none={t('orders.any_status')}
          value={filters.status ?? ''}
          options={ORDER_STATUSES.map((status) => ({
            value: status,
            label: t(`orders.status_${status}`),
          }))}
          onChange={(event) => set({ status: (event.target.value || undefined) as OrderStatus })}
        />
        <TextField
          label={t('orders.from')}
          type="date"
          value={filters.from ?? ''}
          onChange={(event) => set({ from: event.target.value || undefined })}
        />
        <TextField
          label={t('orders.to')}
          type="date"
          value={filters.to ?? ''}
          onChange={(event) => set({ to: event.target.value || undefined })}
        />
      </div>
      {orders.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(orders.error, t)}
        </p>
      ) : orders.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('orders.caption')}
          columns={columns}
          rows={rows}
          rowKey={(order) => order.id}
          empty={
            <EmptyState icon={<Icon icon={ShoppingCart} />} title={t('orders.empty_title')}>
              {t('orders.empty_body')}
            </EmptyState>
          }
          {...(orders.hasNextPage
            ? {
                more: {
                  label: t('common.load_more'),
                  busy: orders.isFetchingNextPage,
                  onClick: () => void orders.fetchNextPage(),
                },
              }
            : {})}
        />
      )}
    </div>
  );
}
