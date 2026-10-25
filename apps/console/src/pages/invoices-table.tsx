import { Link } from '@tanstack/react-router';
import { formatDate, formatMoney } from '@thelamp/i18n';
import type { InvoiceResult } from '@thelamp/shared';
import { Button, type Column, DataTable, EmptyState } from '@thelamp/ui-web';
import { Receipt } from 'lucide-react';
import { useInvoices } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { InvoiceStatusBadge } from './shared';

/** Invoices newest first, for every tenant or one, a page at a time (decision D90). */
export function InvoicesTable({
  tenantId,
  status,
  caption,
}: {
  tenantId?: string;
  status?: 'issued' | 'paid';
  caption: string;
}) {
  const { t, locale } = useLanguage();
  const invoices = useInvoices({
    ...(tenantId ? { tenantId } : {}),
    ...(status ? { status } : {}),
  });
  const day = (value: string) => formatDate(value, { locale });
  const columns: Column<InvoiceResult>[] = [
    {
      key: 'number',
      header: t('console.col_number'),
      render: (row) => (
        <Link to="/invoices/$invoiceId" params={{ invoiceId: row.id }} className="font-semibold">
          {row.number}
        </Link>
      ),
    },
    ...(tenantId
      ? []
      : [
          {
            key: 'tenant',
            header: t('console.col_tenant'),
            render: (row: InvoiceResult) => (
              <Link to="/tenants/$tenantId" params={{ tenantId: row.tenant.id }}>
                {row.tenant.name}
              </Link>
            ),
          },
        ]),
    { key: 'kind', header: t('console.col_kind'), render: (row) => t(`console.kind_${row.kind}`) },
    {
      key: 'period',
      header: t('console.col_period'),
      render: (row) =>
        t('console.term_value', { from: day(row.period.from), to: day(row.period.to) }),
    },
    { key: 'issued', header: t('console.col_issued'), render: (row) => day(row.issuedOn) },
    { key: 'due', header: t('console.col_due'), render: (row) => day(row.dueOn) },
    {
      key: 'total',
      header: t('console.col_total'),
      align: 'end',
      render: (row) => formatMoney(row.total as `${number}`, { locale }),
    },
    {
      key: 'status',
      header: t('console.col_status'),
      render: (row) => <InvoiceStatusBadge invoice={row} />,
    },
  ];

  if (invoices.isError) {
    return (
      <>
        <p className="ks-help error" role="alert">
          {errorMessage(invoices.error, t)}
        </p>
        <Button variant="secondary" className="self-start" onClick={() => void invoices.refetch()}>
          {t('common.retry')}
        </Button>
      </>
    );
  }
  if (invoices.isPending) return <p className="ks-muted">{t('common.loading')}</p>;
  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={invoices.data.pages.flatMap((page) => page.items)}
      rowKey={(row) => row.id}
      empty={
        <EmptyState icon={<Receipt aria-hidden="true" />} title={t('console.no_invoices_title')}>
          {t('console.no_invoices')}
        </EmptyState>
      }
      {...(invoices.hasNextPage
        ? {
            more: {
              label: t('console.load_more'),
              busy: invoices.isFetchingNextPage,
              onClick: () => void invoices.fetchNextPage(),
            },
          }
        : {})}
    />
  );
}
