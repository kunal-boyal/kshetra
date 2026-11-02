import { formatMoney, formatMonth } from '@thelamp/i18n';
import { newId, type PayRunResult, todayIn } from '@thelamp/shared';
import {
  Button,
  type Column,
  Confirm,
  DataTable,
  EmptyState,
  Icon,
  Notice,
  PageHeader,
  PeriodStepper,
  SelectField,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { Calculator, Check, FileText, Plus, RefreshCw, TriangleAlert } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { Facts, fieldErrors } from '../people/shared';
import { usePayRun, usePayrollWrites } from './statutory-data';

type Row = PayRunResult['payslips'][number];

/**
 * The month's pay run (M14, BR-56 to BR-58, decision D128): start it, see each person's gross,
 * deductions and net with anything needing the accountant flagged, add an adjustment, work it out
 * again, and approve it, which freezes every payslip. Until a chartered accountant has reviewed
 * the rules and rates, the page says so.
 */
export function PayRunPage() {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const thisMonth = todayIn(access.timezone).slice(0, 7);
  const [period, setPeriod] = useState(thisMonth);
  const run = usePayRun(period);
  const writes = usePayrollWrites();
  const [busy, setBusy] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const money = (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: access.currency });
  const month = formatMonth(period, { locale });

  async function act(name: string, work: () => Promise<unknown>) {
    setBusy(name);
    setFailure(undefined);
    try {
      await work();
      setConfirming(false);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(undefined);
    }
  }

  const data = run.data;
  const columns: Column<Row>[] = [
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
      header: t('report.col_gross_earned'),
      align: 'end',
      render: (row) => money(row.gross),
    },
    {
      key: 'deductions',
      header: t('report.col_total_deductions'),
      align: 'end',
      render: (row) => money(row.totalDeductions),
    },
    {
      key: 'net',
      header: t('report.col_net_pay'),
      align: 'end',
      render: (row) => <strong>{money(row.net)}</strong>,
    },
    {
      key: 'flags',
      header: t('payrun.col_needs'),
      render: (row) =>
        row.flags.length === 0 ? (
          '—'
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.flags.map((flag) => (
              <StatusBadge key={flag} variant="pending">
                {t(`payrun.flag_${flag as 'surcharge'}`)}
              </StatusBadge>
            ))}
          </span>
        ),
    },
    {
      key: 'payslip',
      header: t('payroll.col_actions'),
      render: (row) => (
        <Link
          to="/pay-run/$userId/$period"
          params={{ userId: row.user.id, period }}
          className="ks-btn secondary sm"
          aria-label={`${t('payroll.payslip')}: ${row.user.name}`}
        >
          <Icon icon={FileText} size="sm" />
          {t('payroll.payslip')}
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('payrun.title_month', { month })}
        toolbar={
          <PeriodStepper
            value={period}
            onChange={(next) => {
              setPeriod(next);
              setConfirming(false);
              setAdjusting(false);
              setFailure(undefined);
            }}
            max={thisMonth}
            format={(value) => formatMonth(value, { locale })}
            label={t('payroll.period')}
            previousLabel={t('targets.previous_month')}
            nextLabel={t('targets.next_month')}
          />
        }
      />
      {data && !data.reviewed ? (
        <Notice icon={<Icon icon={TriangleAlert} />}>{t('payroll.awaiting_review')}</Notice>
      ) : null}
      {failure !== undefined && !adjusting ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {run.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(run.error, t)}
        </p>
      ) : run.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : !data ? (
        <EmptyState icon={<Icon icon={Calculator} />} title={t('payrun.none_title', { month })}>
          <span className="flex flex-col items-start gap-3">
            {t('payrun.none_body')}
            <Button
              variant="primary"
              icon={<Icon icon={Plus} />}
              busy={busy === 'start'}
              onClick={() => void act('start', () => writes.start(period))}
            >
              {t('payrun.start')}
            </Button>
          </span>
        </EmptyState>
      ) : (
        <>
          <section className="ks-card flex flex-col gap-4" aria-label={t('payrun.summary')}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <StatusBadge variant={data.status === 'approved' ? 'success' : 'waiting'}>
                {t(data.status === 'approved' ? 'payroll.run_approved' : 'payroll.run_draft')}
              </StatusBadge>
              <span className="ks-meta">
                {t('payrun.rate_set', { set: data.rateSet.id, from: data.rateSet.from })}
              </span>
            </div>
            <Facts
              items={[
                [t('payrun.people'), String(data.payslips.length)],
                [t('report.col_gross_earned'), money(data.totals.gross)],
                [t('report.col_total_deductions'), money(data.totals.deductions)],
                [t('report.col_net_pay'), money(data.totals.net)],
                [t('payrun.employer'), money(data.totals.employer)],
              ]}
            />
            {data.status === 'draft' ? (
              confirming ? (
                <Confirm
                  question={t('payrun.approve_question', { month })}
                  action={
                    <Button
                      variant="primary"
                      icon={<Icon icon={Check} />}
                      busy={busy === 'approve'}
                      onClick={() =>
                        void act('approve', () => writes.approve(period, data.version))
                      }
                    >
                      {t('payrun.approve')}
                    </Button>
                  }
                  cancel={
                    <Button variant="secondary" onClick={() => setConfirming(false)}>
                      {t('payroll.cancel')}
                    </Button>
                  }
                >
                  <p>{t('payrun.approve_body')}</p>
                </Confirm>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    icon={<Icon icon={Check} />}
                    onClick={() => setConfirming(true)}
                  >
                    {t('payrun.approve')}
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<Icon icon={RefreshCw} />}
                    busy={busy === 'recompute'}
                    onClick={() => void act('recompute', () => writes.recompute(period))}
                  >
                    {t('payrun.recompute')}
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<Icon icon={Plus} />}
                    onClick={() => {
                      setAdjusting(true);
                      setFailure(undefined);
                    }}
                  >
                    {t('payrun.adjust')}
                  </Button>
                </div>
              )
            ) : (
              <p className="ks-meta">{t('payrun.frozen')}</p>
            )}
          </section>
          {adjusting ? (
            <Adjustment
              period={period}
              people={data.payslips.map((row) => row.user)}
              onDone={() => setAdjusting(false)}
            />
          ) : null}
          <DataTable
            caption={t('payrun.caption', { month })}
            columns={columns}
            rows={data.payslips}
            rowKey={(row) => row.user.id}
            empty={<p className="ks-muted">{t('payrun.nobody')}</p>}
          />
        </>
      )}
    </div>
  );
}

/** An earning or deduction for one person in the month, worked in on the next recompute. */
function Adjustment({
  period,
  people,
  onDone,
}: {
  period: string;
  people: { id: string; code: string; name: string }[];
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const writes = usePayrollWrites();
  const [userId, setUserId] = useState('');
  const [kind, setKind] = useState<'earning' | 'deduction'>('earning');
  const [key, setKey] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errors = fieldErrors(failure);
  const at = (path: string) => (errors[path] ? { error: errors[path] } : {});

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      await writes.adjust({
        id: newId(),
        userId,
        period,
        kind,
        key: key.trim(),
        amount: amount.trim().replaceAll(',', ''),
        note: note.trim(),
      });
      await writes.recompute(period);
      onDone();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      className="ks-card flex flex-col gap-4"
      aria-label={t('payrun.adjust')}
      onSubmit={(event) => void submit(event)}
    >
      <h2 className="heading-md">{t('payrun.adjust')}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label={t('payroll.col_person')}
          value={userId}
          none={t('payrun.choose_person')}
          required
          options={people.map((person) => ({
            value: person.id,
            label: `${person.name} (${person.code})`,
          }))}
          {...at('userId')}
          onChange={(event) => setUserId(event.target.value)}
        />
        <SelectField
          label={t('payrun.kind')}
          value={kind}
          options={[
            { value: 'earning', label: t('payrun.kind_earning') },
            { value: 'deduction', label: t('payrun.kind_deduction') },
          ]}
          onChange={(event) => setKind(event.target.value as 'earning' | 'deduction')}
        />
        <TextField
          label={t('payrun.key')}
          help={t('payrun.key_help')}
          required
          value={key}
          {...at('key')}
          onChange={(event) => setKey(event.target.value)}
        />
        <TextField
          label={t('payrun.amount')}
          inputMode="decimal"
          numeric
          required
          value={amount}
          {...at('amount')}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      <TextField
        label={t('payrun.note')}
        required
        value={note}
        {...at('note')}
        onChange={(event) => setNote(event.target.value)}
      />
      {failure !== undefined && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" busy={busy} disabled={!userId}>
          {t('payrun.add_adjustment')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('payroll.cancel')}
        </Button>
      </div>
    </form>
  );
}
