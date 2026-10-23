import { formatDate, formatMoney } from '@thelamp/i18n';
import {
  AccountFinanceResult,
  type AgeingBucket,
  FinanceSnapshot,
  financialYear,
  LedgerEntriesResult,
  newId,
  type StatementResult,
  StatementResult as StatementSchema,
  todayIn,
} from '@thelamp/shared';
import {
  Button,
  type Column,
  DataTable,
  Icon,
  Notice,
  SelectField,
  TextField,
} from '@thelamp/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { Facts, fieldErrors, Section } from '../people/shared';

type Translate = ReturnType<typeof useLanguage>['t'];

/** A bucket as a person reads it: "0–30 days", "Over 180 days". */
export function bucketLabel(bucket: AgeingBucket, t: Translate): string {
  return bucket.toDays === null
    ? t('finance.bucket_over', { days: bucket.fromDays - 1 })
    : t('finance.bucket', { from: bucket.fromDays, to: bucket.toDays });
}

/**
 * An account's finance (M11, decision D79): the latest balance with its date, credit limit and
 * ageing, and a financial year's statement with its opening, running and closing balances
 * (BR-21). Back office records a balance or a statement entry here.
 */
export function FinanceSection({ accountId }: { accountId: string }) {
  const { t, locale } = useLanguage();
  const { client, queryClient } = useApp();
  const access = useAccess();
  const settings = useConfig(client, queryClient).data?.bundle.settings;
  const startMonth = settings?.financialYearStartMonth ?? 4;
  const current = financialYear(todayIn(access.timezone), startMonth).startYear;
  const [year, setYear] = useState(current);
  const finance = useQuery({
    queryKey: ['finance', accountId],
    queryFn: () => read(client, `/v1/accounts/${accountId}/finance`, AccountFinanceResult),
  });
  const statement = useQuery({
    queryKey: ['finance', accountId, 'statement', year],
    queryFn: () =>
      read(client, `/v1/accounts/${accountId}/statement?year=${year}`, StatementSchema),
  });
  const money = (amount: string) =>
    formatMoney(amount as `${number}`, { locale, currency: access.currency });
  const date = (value: string) => formatDate(value, { locale });
  const buckets = settings?.ageingBuckets ?? [];
  const latest = finance.data?.latest;

  const columns: Column<StatementResult['entries'][number]>[] = [
    { key: 'date', header: t('finance.date'), render: (entry) => date(entry.date) },
    {
      key: 'reference',
      header: t('finance.reference'),
      render: (entry) => (
        <span className="flex flex-col">
          <code>{entry.reference}</code>
          {entry.description ? <span className="ks-muted">{entry.description}</span> : null}
        </span>
      ),
    },
    {
      key: 'debit',
      header: t('finance.debit'),
      align: 'end',
      render: (entry) => (Number(entry.debit) > 0 ? money(entry.debit) : ''),
    },
    {
      key: 'credit',
      header: t('finance.credit'),
      align: 'end',
      render: (entry) => (Number(entry.credit) > 0 ? money(entry.credit) : ''),
    },
    {
      key: 'balance',
      header: t('finance.balance'),
      align: 'end',
      render: (entry) => money(entry.balance),
    },
  ];

  return (
    <Section title={t('finance.title')}>
      {finance.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(finance.error, t)}
        </p>
      ) : latest ? (
        <>
          <Facts
            items={[
              [t('finance.as_of'), date(latest.asOf)],
              [t('finance.outstanding'), money(latest.outstanding)],
              [t('finance.credit_limit'), latest.creditLimit ? money(latest.creditLimit) : '—'],
              [
                t('finance.inventory_value'),
                latest.inventoryValue ? money(latest.inventoryValue) : '—',
              ],
              [t('finance.source'), latest.source],
              ...buckets.flatMap((bucket) =>
                latest.ageing[bucket.key]
                  ? [
                      [bucketLabel(bucket, t), money(latest.ageing[bucket.key]!)] as [
                        string,
                        string,
                      ],
                    ]
                  : [],
              ),
            ]}
          />
        </>
      ) : finance.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <p className="ks-muted">{t('finance.no_balance')}</p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <SelectField
          label={t('finance.year')}
          value={String(year)}
          options={[0, 1, 2, 3, 4].map((back) => ({
            value: String(current - back),
            label: t('finance.year_label', { from: current - back, to: current - back + 1 }),
          }))}
          onChange={(event) => setYear(Number(event.target.value))}
        />
      </div>
      {statement.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(statement.error, t)}
        </p>
      ) : statement.data ? (
        <>
          <Facts
            items={[
              [t('finance.opening'), money(statement.data.opening)],
              [t('finance.closing'), money(statement.data.closing)],
            ]}
          />
          {statement.data.truncated ? (
            <Notice icon={<Icon icon={Info} />}>
              {t('finance.truncated', { count: statement.data.count })}
            </Notice>
          ) : null}
          <DataTable
            caption={t('finance.statement_caption')}
            columns={columns}
            rows={statement.data.entries}
            rowKey={(entry) => entry.id}
            empty={<p className="ks-muted">{t('finance.no_entries')}</p>}
          />
        </>
      ) : (
        <p className="ks-muted">{t('common.loading')}</p>
      )}

      {access.can('finance.manage') ? (
        <div className="grid gap-6 md:grid-cols-2">
          <SnapshotForm accountId={accountId} buckets={buckets} />
          <EntryForm accountId={accountId} />
        </div>
      ) : null}
    </Section>
  );
}

function SnapshotForm({
  accountId,
  buckets,
}: {
  accountId: string;
  buckets: readonly AgeingBucket[];
}) {
  const { t } = useLanguage();
  const { client } = useApp();
  const queryClient = useQueryClient();
  const access = useAccess();
  const [asOf, setAsOf] = useState(() => todayIn(access.timezone));
  const [outstanding, setOutstanding] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [ageing, setAgeing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const errors = fieldErrors(failure);
  const at = (path: string) => (errors[path] ? { error: errors[path] } : {});

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    setSaved(false);
    try {
      await write(client, 'POST', '/v1/finance-snapshots', FinanceSnapshot, {
        id: newId(),
        accountId,
        asOf,
        outstanding: outstanding.trim(),
        creditLimit: creditLimit.trim() || null,
        ageing: Object.fromEntries(
          Object.entries(ageing).filter(([, amount]) => amount.trim() !== ''),
        ),
        source: t('finance.back_office'),
      });
      await queryClient.invalidateQueries({ queryKey: ['finance', accountId] });
      setOutstanding('');
      setCreditLimit('');
      setAgeing({});
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="ks-card flex flex-col gap-3"
      noValidate
      aria-label={t('finance.record_balance')}
      onSubmit={(event) => void submit(event)}
    >
      <h3 className="heading-sm">{t('finance.record_balance')}</h3>
      {failure && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <TextField
        label={t('finance.as_of')}
        type="date"
        value={asOf}
        {...at('asOf')}
        onChange={(event) => setAsOf(event.target.value)}
      />
      <TextField
        label={t('finance.outstanding')}
        numeric
        inputMode="decimal"
        required
        value={outstanding}
        {...at('outstanding')}
        onChange={(event) => setOutstanding(event.target.value)}
      />
      <TextField
        label={t('finance.credit_limit')}
        numeric
        inputMode="decimal"
        value={creditLimit}
        {...at('creditLimit')}
        onChange={(event) => setCreditLimit(event.target.value)}
      />
      {buckets.map((bucket) => (
        <TextField
          key={bucket.key}
          label={bucketLabel(bucket, t)}
          numeric
          inputMode="decimal"
          value={ageing[bucket.key] ?? ''}
          {...at(`ageing.${bucket.key}`)}
          onChange={(event) => setAgeing({ ...ageing, [bucket.key]: event.target.value })}
        />
      ))}
      {errors.ageing ? (
        <p className="ks-help error" role="alert">
          {errors.ageing}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="secondary"
          busy={busy}
          disabled={!outstanding.trim()}
          icon={<Icon icon={Plus} />}
        >
          {t('finance.record_balance')}
        </Button>
        {saved ? (
          <p className="ks-muted" role="status">
            {t('prices.saved')}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function EntryForm({ accountId }: { accountId: string }) {
  const { t } = useLanguage();
  const { client } = useApp();
  const queryClient = useQueryClient();
  const access = useAccess();
  const [date, setDate] = useState(() => todayIn(access.timezone));
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [side, setSide] = useState<'debit' | 'credit'>('debit');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const errors = fieldErrors(failure);
  const at = (path: string) =>
    errors[`entries[0].${path}`] ? { error: errors[`entries[0].${path}`] } : {};

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    setSaved(false);
    try {
      await write(client, 'POST', '/v1/ledger-entries', LedgerEntriesResult, {
        entries: [
          {
            id: newId(),
            accountId,
            date,
            reference: reference.trim(),
            description: description.trim() || null,
            [side]: amount.trim(),
          },
        ],
      });
      await queryClient.invalidateQueries({ queryKey: ['finance', accountId] });
      setReference('');
      setDescription('');
      setAmount('');
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="ks-card flex flex-col gap-3"
      noValidate
      aria-label={t('finance.add_entry')}
      onSubmit={(event) => void submit(event)}
    >
      <h3 className="heading-sm">{t('finance.add_entry')}</h3>
      <p className="ks-muted">{t('finance.add_entry_help')}</p>
      {failure && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <TextField
        label={t('finance.date')}
        type="date"
        value={date}
        {...at('date')}
        onChange={(event) => setDate(event.target.value)}
      />
      <TextField
        label={t('finance.reference')}
        required
        value={reference}
        {...at('reference')}
        onChange={(event) => setReference(event.target.value)}
      />
      <TextField
        label={t('finance.description')}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <SelectField
        label={t('finance.side')}
        value={side}
        options={[
          { value: 'debit', label: t('finance.debit') },
          { value: 'credit', label: t('finance.credit') },
        ]}
        onChange={(event) => setSide(event.target.value as 'debit' | 'credit')}
      />
      <TextField
        label={t('finance.amount')}
        numeric
        inputMode="decimal"
        required
        value={amount}
        {...at(side)}
        onChange={(event) => setAmount(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="secondary"
          busy={busy}
          disabled={!reference.trim() || !amount.trim()}
          icon={<Icon icon={Plus} />}
        >
          {t('finance.add_entry')}
        </Button>
        {saved ? (
          <p className="ks-muted" role="status">
            {t('prices.saved')}
          </p>
        ) : null}
      </div>
    </form>
  );
}
