import { formatDate, formatMoney, formatMonth, formatNumber } from '@thelamp/i18n';
import { ORDER_STATUSES, type OrderStatus, type OrderSummary, todayIn } from '@thelamp/shared';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
  FilterChips,
  Icon,
  PageHeader,
  PeriodStepper,
  SplitDetail,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { Plus, ShoppingCart, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { useOrders } from './data';
import { ORDER_BADGE, OrderPreview } from './order-preview';

/**
 * The orders register (M10, spec 8.2, decisions D78 and D104): the orders the viewer sees for a
 * month (or the dates asked for), newest first, with chips by status and their counts, beside the
 * chosen order's preview. An order opens its page; the order desk places one.
 */
export function OrdersPage() {
  const { t, locale } = useLanguage();
  const navigate = useNavigate();
  const access = useAccess();
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const ranged = Boolean(range.from || range.to);
  const orders = useOrders({
    ...(status ? { status } : {}),
    ...(ranged ? range : { period }),
  });
  const rows = orders.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = orders.data?.pages[0]?.summary ?? null;
  const chosen = rows.find((order) => order.id === chosenId) ?? rows[0] ?? null;
  const money = (value: string) =>
    formatMoney(value as `${number}`, { locale, currency: access.currency });
  const n = (value: number) => formatNumber(value, { locale });

  const columns: Column<OrderSummary>[] = [
    {
      key: 'number',
      header: t('orders.col_number'),
      render: (order) => (
        <button
          type="button"
          className="ks-cell-link"
          aria-pressed={order.id === chosen?.id}
          onClick={() => setChosenId(order.id)}
        >
          <code>{order.number}</code>
        </button>
      ),
    },
    {
      key: 'date',
      header: t('orders.col_date'),
      align: 'num',
      render: (order) => (
        <span className="whitespace-nowrap">
          {formatDate(
            new Intl.DateTimeFormat('en-CA', { timeZone: access.timezone }).format(
              new Date(order.placedAt),
            ),
            { locale },
          )}
        </span>
      ),
    },
    {
      key: 'account',
      header: t('orders.account'),
      render: (order) => <span className="font-semibold">{order.account.name}</span>,
    },
    { key: 'by', header: t('orders.col_taken_by'), render: (order) => order.placedBy.name },
    {
      key: 'total',
      header: t('orders.col_value'),
      align: 'end',
      render: (order) => money(order.total),
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

  const when = ranged
    ? t('orders.meta_range', {
        from: range.from ? formatDate(range.from, { locale }) : '…',
        to: range.to ? formatDate(range.to, { locale }) : '…',
      })
    : formatMonth(period, { locale });
  const meta = summary
    ? summary.orders === 0
      ? t('orders.meta_none', { when })
      : t('orders.meta', {
          when,
          count: summary.orders,
          n: n(summary.orders),
          value: money(summary.value),
        })
    : when;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('orders.title')}
        meta={meta}
        actions={
          access.can('order.create') ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Icon icon={Plus} />}
              onClick={() => void navigate({ to: '/orders/new' })}
            >
              {t('orders.new')}
            </Button>
          ) : null
        }
        toolbar={
          <>
            <FilterChips<OrderStatus>
              label={t('orders.status')}
              value={status}
              onChange={(next) => {
                setStatus(next);
                setChosenId(null);
              }}
              clearable
              formatCount={n}
              choices={ORDER_STATUSES.map((entry) => ({
                value: entry,
                label: t(`orders.status_${entry}`),
                ...(summary ? { count: summary.counts[entry] ?? 0 } : {}),
              }))}
            >
              <Button
                variant="ghost"
                size="sm"
                icon={<Icon icon={SlidersHorizontal} />}
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((open) => !open)}
              >
                {t('orders.more_filters')}
              </Button>
            </FilterChips>
            {ranged ? null : (
              <PeriodStepper
                value={period}
                onChange={(next) => {
                  setPeriod(next);
                  setChosenId(null);
                }}
                format={(value) => formatMonth(value, { locale })}
                label={t('plan.month')}
                previousLabel={t('targets.previous_month')}
                nextLabel={t('targets.next_month')}
              />
            )}
          </>
        }
      />
      {filtersOpen ? (
        <div className="ks-card grid gap-3 sm:grid-cols-2" role="search">
          <TextField
            label={t('orders.from')}
            type="date"
            help={t('orders.range_help')}
            value={range.from ?? ''}
            onChange={(event) =>
              setRange((current) => ({ ...current, from: event.target.value || undefined }))
            }
          />
          <TextField
            label={t('orders.to')}
            type="date"
            value={range.to ?? ''}
            onChange={(event) =>
              setRange((current) => ({ ...current, to: event.target.value || undefined }))
            }
          />
        </div>
      ) : null}
      {orders.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(orders.error, t)}
        </p>
      ) : orders.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Icon icon={ShoppingCart} />} title={t('orders.empty_title')}>
          {t('orders.empty_body')}
        </EmptyState>
      ) : (
        <SplitDetail
          detailLabel={
            chosen ? t('orders.number', { number: String(chosen.number) }) : t('orders.title')
          }
          list={
            <DataTable
              caption={t('orders.caption')}
              columns={columns}
              rows={rows}
              rowKey={(order) => order.id}
              selectedKey={chosen?.id ?? null}
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
          }
          detail={chosen ? <OrderPreview key={chosen.id} id={chosen.id} /> : null}
        />
      )}
    </div>
  );
}
