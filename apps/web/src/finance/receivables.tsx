import { formatDate, formatMoney, formatNumber } from '@thelamp/i18n';
import {
  type AccountInvoiceRow,
  AccountInvoiceListResult,
  type AccountReceiptRow,
  AccountReceiptListResult,
  type AgeingBucket,
  type ReceivablesResult,
  scaled,
} from '@thelamp/shared';
import { type Column, DataTable, StackedBar, StatTile, StatusBadge } from '@thelamp/ui-web';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess } from '../people/data';
import { ageingTone, bucketLabel } from './finance-section';

/** An account's invoices or receipts, a page at a time (decision D106). */
function useRegister<T>(
  accountId: string,
  path: 'invoices?status=open' | 'receipts',
  schema: z.ZodType<{ items: T[]; nextCursor: string | null }>,
) {
  const { client } = useApp();
  return useInfiniteQuery({
    queryKey: ['finance', accountId, path],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/accounts/${accountId}/${path}${path.includes('?') ? '&' : '?'}limit=50${
          pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
        }`,
        schema,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * What an account owes by its invoices (M11, BR-51, decision D121): outstanding, not yet due and
 * overdue, the credit limit, ageing by days past due, and the open invoices and receipts behind
 * them, from the customer's books.
 */
export function ReceivablesPanel({
  accountId,
  figures,
  buckets,
}: {
  accountId: string;
  figures: ReceivablesResult;
  buckets: readonly AgeingBucket[];
}) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const money = (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: access.currency });
  const date = (value: string) => formatDate(value, { locale });
  const invoices = useRegister<AccountInvoiceRow>(
    accountId,
    'invoices?status=open',
    AccountInvoiceListResult,
  );
  const receipts = useRegister<AccountReceiptRow>(accountId, 'receipts', AccountReceiptListResult);
  const limit = figures.creditLimit;
  const share =
    limit && scaled(limit, 2) > 0n
      ? Number(scaled(figures.outstanding, 2)) / Number(scaled(limit, 2))
      : null;

  const invoiceColumns: Column<AccountInvoiceRow>[] = [
    { key: 'number', header: t('receivables.invoice'), render: (row) => <code>{row.number}</code> },
    { key: 'date', header: t('finance.date'), render: (row) => date(row.date) },
    { key: 'due', header: t('receivables.due'), render: (row) => date(row.dueDate) },
    {
      key: 'late',
      header: t('receivables.status'),
      render: (row) =>
        row.daysPastDue === null ? (
          <StatusBadge variant="neutral">{t('receivables.not_due')}</StatusBadge>
        ) : (
          <StatusBadge variant={row.daysPastDue > 90 ? 'danger' : 'pending'}>
            {t('receivables.days_late', { count: row.daysPastDue })}
          </StatusBadge>
        ),
    },
    {
      key: 'amount',
      header: t('finance.amount'),
      align: 'end',
      render: (row) => money(row.amount),
    },
    { key: 'open', header: t('receivables.open'), align: 'end', render: (row) => money(row.open) },
  ];
  const receiptColumns: Column<AccountReceiptRow>[] = [
    {
      key: 'number',
      header: t('receivables.receipt'),
      render: (row) => (
        <span className="flex flex-col">
          <code>{row.number}</code>
          {row.kind === 'credit_note' ? (
            <span className="ks-muted">{t('receivables.credit_note')}</span>
          ) : null}
        </span>
      ),
    },
    { key: 'date', header: t('finance.date'), render: (row) => date(row.date) },
    {
      key: 'settled',
      header: t('receivables.settled'),
      render: (row) =>
        row.cancelled
          ? t('receivables.cancelled')
          : row.settled.map((entry) => `${entry.invoice} (${money(entry.amount)})`).join(', ') ||
            '—',
    },
    {
      key: 'amount',
      header: t('finance.amount'),
      align: 'end',
      render: (row) => money(row.amount),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="ks-meta">{t('receivables.from_invoices', { date: date(figures.asOf) })}</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('finance.outstanding')}
          value={money(figures.outstanding)}
          {...(scaled(figures.advance, 2) > 0n
            ? { sub: t('receivables.advance', { amount: money(figures.advance) }) }
            : {})}
        />
        <StatTile label={t('receivables.not_due')} value={money(figures.notDue)} />
        <StatTile
          label={t('receivables.overdue')}
          value={money(figures.overdue)}
          {...(figures.oldestDue
            ? { sub: t('receivables.oldest_due', { date: date(figures.oldestDue) }) }
            : {})}
          {...(scaled(figures.overdue, 2) > 0n ? { tone: 'danger' as const } : {})}
        />
        {limit && share !== null ? (
          <StatTile
            label={t('finance.credit_limit')}
            value={money(limit)}
            meter={share}
            {...(share > 1 ? { tone: 'danger' as const } : {})}
            sub={t('finance.credit_used', {
              share: formatNumber(
                share,
                { locale },
                { style: 'percent', maximumFractionDigits: 0 },
              ),
            })}
          />
        ) : (
          <StatTile label={t('finance.credit_limit')} value="—" sub={t('finance.no_limit')} />
        )}
      </div>
      {scaled(figures.overdue, 2) > 0n ? (
        <div className="flex flex-col gap-2">
          <h3 className="heading-sm">{t('finance.ageing')}</h3>
          <StackedBar
            label={t('finance.ageing')}
            format={(value) => money(String(value))}
            parts={buckets.map((bucket, index) => ({
              label: bucketLabel(bucket, t),
              value: Number(figures.ageing[bucket.key] ?? 0),
              tone: ageingTone(index, buckets.length),
            }))}
          />
        </div>
      ) : null}
      <section className="flex flex-col gap-2" aria-label={t('receivables.open_invoices')}>
        <h3 className="heading-sm">{t('receivables.open_invoices')}</h3>
        {invoices.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(invoices.error, t)}
          </p>
        ) : (
          <DataTable
            caption={t('receivables.open_invoices')}
            columns={invoiceColumns}
            rows={invoices.data?.pages.flatMap((page) => page.items) ?? []}
            rowKey={(row) => row.id}
            empty={<p className="ks-muted">{t('receivables.none_open')}</p>}
            {...(invoices.hasNextPage
              ? {
                  more: {
                    onClick: () => void invoices.fetchNextPage(),
                    busy: invoices.isFetchingNextPage,
                  },
                }
              : {})}
          />
        )}
      </section>
      <section className="flex flex-col gap-2" aria-label={t('receivables.receipts')}>
        <h3 className="heading-sm">{t('receivables.receipts')}</h3>
        {receipts.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(receipts.error, t)}
          </p>
        ) : (
          <DataTable
            caption={t('receivables.receipts')}
            columns={receiptColumns}
            rows={receipts.data?.pages.flatMap((page) => page.items) ?? []}
            rowKey={(row) => row.id}
            empty={<p className="ks-muted">{t('receivables.no_receipts')}</p>}
            {...(receipts.hasNextPage
              ? {
                  more: {
                    onClick: () => void receipts.fetchNextPage(),
                    busy: receipts.isFetchingNextPage,
                  },
                }
              : {})}
          />
        )}
      </section>
    </div>
  );
}
