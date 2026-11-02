import {
  amountInWords,
  formatMoney,
  formatMonth,
  formatNumber,
  type MessageKey,
} from '@thelamp/i18n';
import type { StatutoryPayslip } from '@thelamp/shared';
import { Icon, Notice } from '@thelamp/ui-web';
import { TriangleAlert } from 'lucide-react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { PageHeader } from '../people/shared';
import { Printable, PrintButton } from '../print';
import { useStatutoryPayslip } from './statutory-data';

/** The words for a payslip's lines; an allowance or adjustment of the tenant's own shows its key. */
const LINE_WORDS: Record<string, MessageKey> = {
  basic: 'payslip.line_basic',
  da: 'payslip.line_da',
  hra: 'payslip.line_hra',
  conveyance: 'payslip.line_conveyance',
  special: 'payslip.line_special',
  pf: 'payslip.line_pf',
  esi: 'payslip.line_esi',
  pt: 'payslip.line_pt',
  lwf: 'payslip.line_lwf',
  tds: 'payslip.line_tds',
  epf: 'payslip.line_epf',
  eps: 'payslip.line_eps',
  edli: 'payslip.line_edli',
  pf_admin: 'payslip.line_pf_admin',
};

/**
 * A statutory payslip (M14, BR-56 to BR-58, decisions D99 and D128): one person's month with their
 * UAN and ESI number, the days paid, each earning and deduction, net pay in figures and words, and
 * the employer's contributions, printed through the browser. A draft says so; until a chartered
 * accountant has reviewed the rules and rates, every copy says that too.
 */
export function StatutoryPayslipPage({ userId, period }: { userId: string; period: string }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const payslip = useStatutoryPayslip(userId, period);
  const month = formatMonth(period, { locale });
  const slip = payslip.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ to: '/pay-run', label: t('payrun.back') }}
        title={t('payslip.title', { month })}
      >
        {slip ? <PrintButton printable="statutory-payslip" /> : null}
      </PageHeader>
      {payslip.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(payslip.error, t)}
        </p>
      ) : !slip ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <Printable
          id="statutory-payslip"
          title={t('payslip.title', { month })}
          details={[
            `${slip.user.name} (${slip.user.code})`,
            ...(slip.status === 'draft' ? [t('payslip.draft')] : []),
            ...(slip.reviewed ? [] : [t('payroll.awaiting_review')]),
          ]}
        >
          <Slip slip={slip} currency={access.currency} locale={locale} />
        </Printable>
      )}
    </div>
  );
}

function Slip({
  slip,
  currency,
  locale,
}: {
  slip: StatutoryPayslip;
  currency: string;
  locale: 'en' | 'hi';
}) {
  const { t } = useLanguage();
  const money = (amount: string) => formatMoney(amount as `${number}`, { locale, currency });
  const count = (value: number) => formatNumber(value, { locale });
  const word = (key: string) => (LINE_WORDS[key] ? t(LINE_WORDS[key]) : key.replaceAll('_', ' '));
  const table = (caption: string, lines: StatutoryPayslip['earnings'], total?: string) => (
    <table className="ks-table">
      <caption className="heading-sm text-start">{caption}</caption>
      <tbody>
        {lines.map((line) => (
          <tr key={line.key}>
            <th scope="row">{word(line.key)}</th>
            <td className="text-end">{money(line.amount)}</td>
          </tr>
        ))}
        {total ? (
          <tr>
            <th scope="row">{t('payslip.total')}</th>
            <td className="text-end font-semibold">{money(total)}</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
  return (
    <section className="ks-card flex flex-col gap-4" aria-labelledby="payslip-person">
      <h2 id="payslip-person" className="heading-md">
        {slip.user.name} · {slip.user.code}
      </h2>
      {slip.reviewed ? null : (
        <Notice icon={<Icon icon={TriangleAlert} />}>{t('payroll.awaiting_review')}</Notice>
      )}
      <dl className="grid gap-3 sm:grid-cols-3">
        {(
          [
            [t('payslip.uan'), slip.profile.uan ?? '—'],
            [t('payslip.esi_number'), slip.profile.esiNumber ?? '—'],
            [
              t('payslip.pan'),
              t(slip.profile.panOnFile ? 'payslip.pan_on_file' : 'payslip.pan_missing'),
            ],
            [
              t('payslip.work_state'),
              slip.profile.workState ? t(`state.${slip.profile.workState}`) : '—',
            ],
            [
              t('payslip.paid_days'),
              t('payroll.days_of', { paid: count(slip.paid), scheduled: count(slip.scheduled) }),
            ],
            [t('report.col_pf_wages'), money(slip.wages)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1">
            <dt className="ks-meta">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-4 md:grid-cols-2">
        {table(t('payslip.earnings'), slip.earnings, slip.gross)}
        {table(t('payslip.deductions'), slip.deductions, slip.totalDeductions)}
      </div>
      <div className="flex flex-col gap-1">
        <p className="heading-md">{t('payslip.net', { amount: money(slip.net) })}</p>
        <p>{t('payslip.net_words', { words: amountInWords(slip.net, locale) })}</p>
      </div>
      {slip.flags.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label={t('payrun.col_needs')}>
          {slip.flags.map((flag) => (
            <li key={flag} className="ks-help">
              {t(`payrun.flag_${flag as 'surcharge'}_note`)}
            </li>
          ))}
        </ul>
      ) : null}
      {slip.employer.length > 0 ? table(t('payslip.employer'), slip.employer) : null}
    </section>
  );
}
