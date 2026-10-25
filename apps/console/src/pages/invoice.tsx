import { Link } from '@tanstack/react-router';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@thelamp/i18n';
import {
  type InvoiceResult,
  newId,
  PAYMENT_METHODS,
  type PaymentMethod,
  scaled,
  unscaled,
} from '@thelamp/shared';
import {
  Button,
  Card,
  type Column,
  DataTable,
  Notice,
  SelectField,
  TextField,
} from '@thelamp/ui-web';
import { ArrowLeft, Download } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useConsole } from '../context';
import { useConsoleMutations, useInvoice } from '../data';
import { errorMessage, fieldErrors, useLanguage } from '../i18n';
import { billingToday, holds, InvoiceStatusBadge, VIEWER_TIME_ZONE } from './shared';

type Line = InvoiceResult['lines'][number];
type Payment = InvoiceResult['payments'][number];

/** What an invoice still owes: its total less what was paid, exactly. */
export const owedOn = (invoice: Pick<InvoiceResult, 'total' | 'paid'>) =>
  unscaled(scaled(invoice.total, 2) - scaled(invoice.paid, 2), 2);

/** One invoice as issued, its payments, its PDF, and recording a payment (decision D90). */
export function InvoicePage({ invoiceId }: { invoiceId: string }) {
  const { client } = useConsole();
  const { t, locale } = useLanguage();
  const invoice = useInvoice(invoiceId);
  const [failure, setFailure] = useState<string>();
  const [downloading, setDownloading] = useState(false);

  if (invoice.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(invoice.error, t)}
      </p>
    );
  }
  if (!invoice.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const row = invoice.data;
  const money = (value: string) => formatMoney(value as `${number}`, { locale });
  const day = (value: string) => formatDate(value, { locale });
  const owed = owedOn(row);
  const half = unscaled(scaled(row.gstRate, 4) * 5n, 5).replace(/\.?0+$/, '');

  async function download() {
    setFailure(undefined);
    setDownloading(true);
    try {
      const file = await client.file(`/platform/v1/invoices/${row.id}/pdf`);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${row.number.replaceAll('/', '-')}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFailure(errorMessage(error, t));
    } finally {
      setDownloading(false);
    }
  }

  const facts: [string, ReactNode][] = [
    [
      t('console.col_tenant'),
      <Link key="tenant" to="/tenants/$tenantId" params={{ tenantId: row.tenant.id }}>
        {row.tenant.name}
      </Link>,
    ],
    [t('console.col_kind'), t(`console.kind_${row.kind}`)],
    [
      t('console.col_period'),
      t('console.term_value', { from: day(row.period.from), to: day(row.period.to) }),
    ],
    [t('console.col_issued'), day(row.issuedOn)],
    [t('console.col_due'), day(row.dueOn)],
    [t('console.place_of_supply'), `${row.buyer.stateName} (${row.buyer.stateCode})`],
    [
      t('console.bill_to'),
      [row.buyer.legalName, row.buyer.gstin ? `GSTIN ${row.buyer.gstin}` : null]
        .filter(Boolean)
        .join(' · '),
    ],
  ];
  const lineColumns: Column<Line>[] = [
    {
      key: 'description',
      header: t('console.col_description'),
      render: (line) => line.description,
    },
    {
      key: 'quantity',
      header: t('console.col_quantity'),
      align: 'end',
      render: (line) =>
        formatNumber(line.quantity as `${number}`, { locale }, { maximumFractionDigits: 4 }),
    },
    {
      key: 'rate',
      header: t('console.col_rate'),
      align: 'end',
      render: (line) => money(line.rate),
    },
    {
      key: 'amount',
      header: t('console.col_amount'),
      align: 'end',
      render: (line) => money(line.amount),
    },
  ];
  const totals: [string, string][] = [[t('console.taxable_value'), row.subtotal]];
  if (scaled(row.igst, 2) > 0n || scaled(row.cgst, 2) === 0n) {
    totals.push([t('console.igst', { rate: row.gstRate }), row.igst]);
  } else {
    totals.push(
      [t('console.cgst', { rate: half }), row.cgst],
      [t('console.sgst', { rate: half }), row.sgst],
    );
  }
  totals.push(
    [t('console.total'), row.total],
    [t('console.paid_so_far'), row.paid],
    [t('console.owed'), owed],
  );
  const paymentColumns: Column<Payment>[] = [
    { key: 'received', header: t('console.col_received'), render: (p) => day(p.receivedOn) },
    {
      key: 'method',
      header: t('console.col_method'),
      render: (p) => t(`console.method_${p.method}`),
    },
    { key: 'reference', header: t('console.col_reference'), render: (p) => p.reference ?? '—' },
    {
      key: 'recorded',
      header: t('console.recorded'),
      render: (p) => formatDateTime(p.recordedAt, { locale, timeZone: VIEWER_TIME_ZONE }),
    },
    {
      key: 'amount',
      header: t('console.col_amount'),
      align: 'end',
      render: (p) => money(p.amount),
    },
  ];

  return (
    <>
      <Link to="/billing" className="ks-btn ghost sm self-start">
        <ArrowLeft size={16} aria-hidden="true" />
        {t('console.billing')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="heading-xl">{t('console.invoice', { number: row.number })}</h1>
        <InvoiceStatusBadge invoice={row} />
      </div>
      {row.example ? <Notice>{t('console.not_tax_invoice')}</Notice> : null}
      <Card>
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {facts.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-1">
                <dt className="ks-muted caption">{label}</dt>
                <dd className="m-0">{value}</dd>
              </div>
            ))}
          </dl>
          <Button
            variant="secondary"
            className="self-start"
            icon={<Download size={16} aria-hidden="true" />}
            busy={downloading}
            onClick={() => void download()}
          >
            {t('console.download_pdf')}
          </Button>
          {failure ? (
            <p className="ks-help error" role="alert">
              {failure}
            </p>
          ) : null}
        </div>
      </Card>
      <DataTable
        caption={t('console.invoice', { number: row.number })}
        columns={lineColumns}
        rows={row.lines}
        rowKey={(line) => line.description}
      />
      <Card>
        <dl className="ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-2">
          {totals.map(([label, value]) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd className="num m-0 text-right">{money(value)}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <h2 className="heading-md">{t('console.payments')}</h2>
      <DataTable
        caption={t('console.payments')}
        columns={paymentColumns}
        rows={row.payments}
        rowKey={(payment) => payment.id}
        empty={<p className="ks-muted">{t('console.no_payments')}</p>}
      />
      {row.status === 'issued' && holds(client.staff, 'platform.billing.manage') ? (
        <PaymentForm invoiceId={row.id} owed={owed} />
      ) : null}
    </>
  );
}

function PaymentForm({ invoiceId, owed }: { invoiceId: string; owed: string }) {
  const { t } = useLanguage();
  const { recordPayment } = useConsoleMutations();
  // One ID for each payment, so sending it twice records it once.
  const [id, setId] = useState(newId);
  const [amount, setAmount] = useState(owed);
  const [method, setMethod] = useState<Exclude<PaymentMethod, 'mandate'>>('bank_transfer');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(billingToday);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();

  async function record(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFailure(undefined);
    try {
      const after = await recordPayment.mutateAsync({
        invoiceId,
        body: {
          id,
          amount: amount.trim(),
          method,
          reference: reference.trim() || null,
          receivedOn,
        },
      });
      setId(newId());
      setReference('');
      setAmount(owedOn(after));
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(errorMessage(error, t));
    }
  }

  return (
    <Card>
      <form className="flex max-w-xl flex-col gap-4" onSubmit={record} noValidate>
        <h2 className="heading-md">{t('console.record_payment')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={t('console.amount')}
            numeric
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            error={errors.amount}
            required
          />
          <SelectField
            label={t('console.col_method')}
            value={method}
            onChange={(event) => setMethod(event.target.value as typeof method)}
            options={PAYMENT_METHODS.filter((value) => value !== 'mandate').map((value) => ({
              value,
              label: t(`console.method_${value}`),
            }))}
          />
          <TextField
            label={t('console.col_reference')}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            error={errors.reference}
          />
          <TextField
            label={t('console.received_on')}
            type="date"
            value={receivedOn}
            onChange={(event) => setReceivedOn(event.target.value)}
            error={errors.receivedOn}
            required
          />
        </div>
        {failure ? (
          <p className="ks-help error" role="alert">
            {failure}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          className="self-start"
          busy={recordPayment.isPending}
          disabled={!amount.trim() || !receivedOn}
        >
          {t('console.record_payment')}
        </Button>
      </form>
    </Card>
  );
}
