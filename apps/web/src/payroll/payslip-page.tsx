import { formatMoney, formatMonth, formatNumber, type MessageKey } from '@thelamp/i18n';
import { type DayStatusKey, PayslipResult } from '@thelamp/shared';
import { EmptyState, Icon } from '@thelamp/ui-web';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess } from '../people/data';
import { PageHeader } from '../people/shared';
import { Printable, PrintButton } from '../print';

/** The days a payslip counts, each by the summary report's word for it. */
const DAY_ROWS: readonly [DayStatusKey, MessageKey][] = [
  ['present', 'report.col_present_days'],
  ['half_day', 'report.col_half_days'],
  ['paid_leave', 'report.col_paid_leave_days'],
  ['unpaid_leave', 'report.col_unpaid_leave_days'],
  ['absent', 'report.col_absent_days'],
  ['holiday', 'report.col_holidays'],
  ['weekly_off', 'report.col_weekly_offs'],
];

/**
 * A payslip preview (M14, decisions D99 and D117): one person's month, their gross, the days by
 * status, the paid days against the scheduled ones and the provisional pay, printed through the
 * browser with the tenant's legal name. Every copy says it is an attendance-based estimate.
 */
export function PayslipPage({ userId, period }: { userId: string; period: string }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const payslip = useQuery({
    queryKey: ['payslip', userId, period],
    queryFn: () => read(client, `/v1/payslips/${userId}/${period}`, PayslipResult),
  });
  const money = (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: access.currency });
  const count = (value: number) => formatNumber(value, { locale });
  const month = formatMonth(period, { locale });
  const slip = payslip.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ to: '/payroll', label: t('payslip.back') }}
        title={t('payslip.title', { month })}
        meta={t('copy.provisional_pay')}
      >
        {slip ? <PrintButton printable="payslip" /> : null}
      </PageHeader>
      {payslip.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(payslip.error, t)}
        </p>
      ) : !slip ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <Printable
          id="payslip"
          title={t('payslip.title', { month })}
          details={[`${slip.user.name} (${slip.user.code})`, t('copy.provisional_pay')]}
        >
          <section className="ks-card flex flex-col gap-4" aria-labelledby="payslip-person">
            <h2 id="payslip-person" className="heading-md">
              {slip.user.name} · {slip.user.code}
            </h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="ks-meta">{t('payslip.gross')}</dt>
                <dd className="font-semibold">
                  {slip.monthlyGross === null ? t('payslip.no_gross') : money(slip.monthlyGross)}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="ks-meta">{t('payslip.paid_days')}</dt>
                <dd className="font-semibold">
                  {t('payroll.days_of', {
                    paid: count(slip.paid),
                    scheduled: count(slip.scheduled),
                  })}
                </dd>
              </div>
            </dl>
            <table className="ks-table">
              <caption className="sr-only">{t('payslip.days')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('payslip.days')}</th>
                  <th scope="col" className="text-end">
                    {t('payslip.count')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {DAY_ROWS.map(([status, label]) => (
                  <tr key={status}>
                    <th scope="row">{t(label)}</th>
                    <td className="text-end">{count(slip.days[status] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {slip.amount === null ? (
              <EmptyState icon={<Icon icon={FileText} />} title={t('payslip.no_gross')}>
                {t('payslip.no_gross_body')}
              </EmptyState>
            ) : (
              <p className="heading-md">
                {t(slip.toDate ? 'payslip.estimate_so_far' : 'payslip.estimate', {
                  amount: money(slip.amount),
                })}
              </p>
            )}
            <p className="ks-meta">{t('copy.provisional_pay')}</p>
          </section>
        </Printable>
      )}
    </div>
  );
}
