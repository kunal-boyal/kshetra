import { formatMoney, formatNumber } from '@thelamp/i18n';
import type { OrderResult, OrderStatus } from '@thelamp/shared';
import { type BadgeVariant, DescriptionList, StatusBadge, Steps, type Step } from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { useDates } from '../people/shared';
import { useOrder } from './data';

/** Each order status as a badge (components/StatusBadge). */
export const ORDER_BADGE: Record<OrderStatus, BadgeVariant> = {
  submitted: 'waiting',
  accepted: 'success',
  partially_accepted: 'pending',
  rejected: 'danger',
  fulfilled: 'success',
  partially_fulfilled: 'info',
  cancelled: 'neutral',
};

/** Statuses an order no longer moves on from: its last step is done, not current. */
const SETTLED = new Set(['fulfilled', 'rejected', 'cancelled']);

/**
 * What happened to an order, oldest first (decision D104): placed (offline when it reached the
 * server late), each approver's decision, each fulfilment and a cancellation, with who and when.
 */
export function OrderTimeline({ order }: { order: OrderResult }) {
  const { t } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const last = order.history.length - 1;
  const steps: Step[] = order.history.map((entry, index) => ({
    state:
      entry.kind === 'rejected' || entry.kind === 'cancelled'
        ? 'rejected'
        : index === last && !SETTLED.has(order.status)
          ? 'current'
          : 'done',
    title: entry.by
      ? t(`orders.history_${entry.kind}_by`, { name: entry.by.name })
      : t(`orders.history_${entry.kind}`),
    meta: [dates.dateTime(entry.at), entry.offline ? t('orders.history_offline') : null]
      .filter(Boolean)
      .join(' · '),
  }));
  return <Steps label={t('orders.timeline')} steps={steps} />;
}

/**
 * The chosen order beside the register (decision D104): its number, account and who took it, its
 * lines, totals with the total in bold, and its timeline, with a way to its own page.
 */
export function OrderPreview({ id }: { id: string }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const order = useOrder(id);
  const money = (value: string) =>
    formatMoney(value as `${number}`, { locale, currency: access.currency });
  if (order.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(order.error, t)}
      </p>
    );
  }
  if (!order.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const data = order.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="ks-spread items-start gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="heading-lg">{t('orders.number', { number: String(data.number) })}</h2>
          <p className="ks-meta">
            {t('orders.preview_meta', {
              account: data.account.name,
              code: data.account.code,
              name: data.placedBy.name,
            })}
          </p>
        </div>
        <StatusBadge variant={ORDER_BADGE[data.status]}>
          {t(`orders.status_${data.status}`)}
        </StatusBadge>
      </div>
      <div className="relative overflow-x-auto">
        <table className="ks-table flat">
          <caption className="sr-only">{t('orders.lines_caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('orders.item')}</th>
              <th scope="col" className="r">
                {t('orders.quantity')}
              </th>
              <th scope="col" className="r">
                {t('orders.total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <tr key={line.id}>
                <th scope="row">
                  {line.item.packLabel
                    ? `${line.item.name}, ${line.item.packLabel}`
                    : line.item.name}
                </th>
                <td className="r">
                  {formatNumber(Number(line.quantity), { locale }, { maximumFractionDigits: 3 })}
                </td>
                <td className="r">{money(line.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DescriptionList
        align="end"
        className="totals"
        items={[
          [t('orders.taxable'), money(data.totals.taxable)],
          [t('orders.tax'), money(data.totals.tax)],
          [t('orders.total'), <b key="total">{money(data.totals.total)}</b>],
        ]}
      />
      <OrderTimeline order={data} />
      <Link
        to="/orders/$orderId"
        params={{ orderId: data.id }}
        className="ks-btn secondary sm self-start"
      >
        {t('orders.open')}
      </Link>
    </div>
  );
}
