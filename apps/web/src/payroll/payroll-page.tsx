import { formatMoney, formatMonth, formatNumber } from '@thelamp/i18n';
import { PayrollGrossResult, PayrollListResult, type PayrollMonth, todayIn } from '@thelamp/shared';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
  Icon,
  PageHeader,
  PeriodStepper,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Download, FileText, Wallet } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { fieldErrors } from '../people/shared';
import { useStartExport } from '../reports/data';

/**
 * Payroll inputs (M14, decisions D14 and D117): everyone the viewer reaches for a month, with the
 * gross in force, the paid days against the scheduled ones, and the provisional pay (BR-26). The
 * current month shows what is earned so far. Gross is set from a month, so earlier months keep
 * theirs; the summary exports for a payroll provider. An estimate, never statutory payroll.
 */
export function PayrollPage() {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const startExport = useStartExport();
  const thisMonth = todayIn(access.timezone).slice(0, 7);
  const [period, setPeriod] = useState(thisMonth);
  const [editing, setEditing] = useState<PayrollMonth>();
  const [gross, setGross] = useState('');
  const [from, setFrom] = useState(thisMonth);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const money = (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: access.currency });
  const count = (value: number) => formatNumber(value, { locale });

  const months = useInfiniteQuery({
    queryKey: ['payroll', period],
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/payroll?period=${period}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        PayrollListResult,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = months.data?.pages.flatMap((page) => page.items) ?? [];

  async function exportSummary() {
    setExporting(true);
    setFailure(undefined);
    try {
      await startExport({ report: 'payroll_summary', format: 'xlsx', locale, filters: { period } });
      await navigate({ to: '/reports' });
    } catch (caught) {
      setFailure(caught);
    } finally {
      setExporting(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setFailure(undefined);
    try {
      await write(client, 'PUT', `/v1/payroll-gross/${editing.user.id}`, PayrollGrossResult, {
        monthlyGross: gross.trim().replaceAll(',', ''),
        from,
      });
      setEditing(undefined);
      await queryClient.invalidateQueries({ queryKey: ['payroll'] });
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }
  const errors = fieldErrors(failure);

  const columns: Column<PayrollMonth>[] = [
    {
      key: 'person',
      header: t('payroll.col_person'),
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">{row.user.name}</span>
          <span className="ks-meta">{row.user.code}</span>
        </span>
      ),
    },
    {
      key: 'gross',
      header: t('payroll.col_gross'),
      align: 'end',
      render: (row) =>
        row.monthlyGross === null ? (
          <StatusBadge variant="pending">{t('payroll.no_gross')}</StatusBadge>
        ) : (
          money(row.monthlyGross)
        ),
    },
    {
      key: 'days',
      header: t('payroll.col_days'),
      align: 'end',
      render: (row) =>
        t('payroll.days_of', { paid: count(row.paid), scheduled: count(row.scheduled) }),
    },
    {
      key: 'estimate',
      header: t('payroll.col_estimate'),
      align: 'end',
      render: (row) =>
        row.amount === null ? (
          '—'
        ) : (
          <span className="flex flex-col items-end">
            <span className="font-semibold">{money(row.amount)}</span>
            {row.toDate ? <span className="ks-meta">{t('payroll.so_far')}</span> : null}
          </span>
        ),
    },
    {
      key: 'actions',
      header: t('payroll.col_actions'),
      render: (row) => (
        <span className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Icon icon={Wallet} size="sm" />}
            aria-label={`${t('payroll.set_gross')}: ${row.user.name}`}
            onClick={() => {
              setEditing(row);
              setGross(row.monthlyGross ?? '');
              setFrom(thisMonth);
              setFailure(undefined);
            }}
          >
            {t('payroll.set_gross')}
          </Button>
          <Link
            to="/payroll/$userId/$period"
            params={{ userId: row.user.id, period }}
            className="ks-btn secondary sm"
            aria-label={`${t('payroll.payslip')}: ${row.user.name}`}
          >
            <Icon icon={FileText} size="sm" />
            {t('payroll.payslip')}
          </Link>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('payroll.title_month', { month: formatMonth(period, { locale }) })}
        meta={t('copy.provisional_pay')}
        actions={
          access.can('report.view') ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Icon icon={Download} />}
              busy={exporting}
              onClick={() => void exportSummary()}
            >
              {t('payroll.export')}
            </Button>
          ) : null
        }
        toolbar={
          <PeriodStepper
            value={period}
            onChange={setPeriod}
            max={thisMonth}
            format={(value) => formatMonth(value, { locale })}
            label={t('payroll.period')}
            previousLabel={t('targets.previous_month')}
            nextLabel={t('targets.next_month')}
          />
        }
      />
      {failure !== undefined && !editing ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {editing ? (
        <form
          className="ks-card flex flex-col gap-4"
          aria-label={t('payroll.gross_for', { name: editing.user.name })}
          onSubmit={(event) => void save(event)}
        >
          <h2 className="heading-md">{t('payroll.gross_for', { name: editing.user.name })}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('payroll.gross')}
              inputMode="decimal"
              required
              value={gross}
              {...(errors.monthlyGross ? { error: errors.monthlyGross } : {})}
              onChange={(event) => setGross(event.target.value)}
            />
            <TextField
              label={t('payroll.from')}
              help={t('payroll.from_help')}
              type="month"
              required
              value={from}
              {...(errors.from ? { error: errors.from } : {})}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          {failure !== undefined && Object.keys(errors).length === 0 ? (
            <p className="ks-help error" role="alert">
              {errorMessage(failure, t)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={busy}>
              {t('payroll.save')}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(undefined)}>
              {t('payroll.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
      {months.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(months.error, t)}
        </p>
      ) : months.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('payroll.title')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.user.id}
          empty={
            <EmptyState icon={<Icon icon={Wallet} />} title={t('payroll.none_title')}>
              {t('payroll.none_body')}
            </EmptyState>
          }
          {...(months.hasNextPage
            ? {
                more: {
                  busy: months.isFetchingNextPage,
                  onClick: () => void months.fetchNextPage(),
                },
              }
            : {})}
        />
      )}
    </div>
  );
}
