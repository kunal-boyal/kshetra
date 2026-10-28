import { formatDate, formatDateTime, formatMoney, formatNumber } from '@thelamp/i18n';
import {
  AccountFinanceResult,
  type AgeingBucket,
  FinanceSnapshot,
  financialYear,
  LedgerEntriesResult,
  newId,
  scaled,
  type StatementResult,
  StatementResult as StatementSchema,
  todayIn,
} from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  type Column,
  DataTable,
  Icon,
  Notice,
  SelectField,
  StackedBar,
  StatTile,
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
import { Printable, PrintButton } from '../print';

type Translate = ReturnType<typeof useLanguage>['t'];

/** A bucket as a person reads it: "0–30 days", "Over 180 days". */
export function bucketLabel(bucket: AgeingBucket, t: Translate): string {
  return bucket.toDays === null
    ? t('finance.bucket_over', { days: bucket.fromDays - 1 })
    : t('finance.bucket', { from: bucket.fromDays, to: bucket.toDays });
}

/** How much of the limit is used, from 0 up; an amount's share, not an amount. */
const used = (outstanding: string, limit: string) =>
  Number(scaled(outstanding, 2)) / Number(scaled(limit, 2));

/** Ageing tones from the newest bucket (on time) to the oldest (danger). */
export function ageingTone(index: number, count: number): BadgeVariant {
  if (index === 0) return 'success';
  if (index === count - 1) return 'danger';
  return index % 2 === 1 ? 'pending' : 'waiting';
}

/**
 * An account's finance (M11, decision D79): the latest balance with its date, credit limit and
 * ageing, and a financial year's statement with its opening, running and closing balances
 * (BR-21). Back office records a balance or a statement entry here.
 */
export function FinanceSection({
  accountId,
  accountName,
}: {
  accountId: string;
  /** The account's name and code, for a printed statement's title. */
  accountName: string;
}) {
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
        <div className="flex flex-col gap-4">
          <p className="ks-meta">
            {t('finance.ledger_from', {
              source: latest.source,
              when: formatDateTime(latest.createdAt, { locale, timeZone: access.timezone }),
            })}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile
              label={t('finance.outstanding')}
              value={money(latest.outstanding)}
              sub={t('finance.as_of_date', { date: date(latest.asOf) })}
            />
            {latest.creditLimit && scaled(latest.creditLimit, 2) > 0n ? (
              <StatTile
                label={t('finance.credit_limit')}
                value={money(latest.creditLimit)}
                meter={used(latest.outstanding, latest.creditLimit)}
                {...(scaled(latest.outstanding, 2) > scaled(latest.creditLimit, 2)
                  ? { tone: 'danger' as const }
                  : {})}
                sub={t('finance.credit_used', {
                  share: formatNumber(
                    used(latest.outstanding, latest.creditLimit),
                    { locale },
                    { style: 'percent', maximumFractionDigits: 0 },
                  ),
                })}
              />
            ) : (
              <StatTile label={t('finance.credit_limit')} value="—" sub={t('finance.no_limit')} />
            )}
            {latest.inventoryValue ? (
              <StatTile label={t('finance.inventory_value')} value={money(latest.inventoryValue)} />
            ) : null}
          </div>
          {buckets.some((bucket) => latest.ageing[bucket.key]) ? (
            <div className="flex flex-col gap-2">
              <h3 className="heading-sm">{t('finance.ageing')}</h3>
              <StackedBar
                label={t('finance.ageing')}
                format={(value) => money(String(value))}
                parts={buckets.map((bucket, index) => ({
                  label: bucketLabel(bucket, t),
                  value: Number(latest.ageing[bucket.key] ?? 0),
                  tone: ageingTone(index, buckets.length),
                }))}
              />
            </div>
          ) : null}
        </div>
      ) : finance.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <p className="ks-muted">{t('finance.no_balance')}</p>
      )}

      <div className="grid items-end gap-4 md:grid-cols-3">
        <SelectField
          label={t('finance.year')}
          value={String(year)}
          options={[0, 1, 2, 3, 4].map((back) => ({
            value: String(current - back),
            // Years as text, so they aren't grouped like amounts (2,026).
            label: t('finance.year_label', {
              from: String(current - back),
              to: String(current - back + 1),
            }),
          }))}
          onChange={(event) => setYear(Number(event.target.value))}
        />
        {statement.data ? (
          <div>
            <PrintButton printable="statement" />
          </div>
        ) : null}
      </div>
      {statement.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(statement.error, t)}
        </p>
      ) : statement.data ? (
        <Printable
          id="statement"
          title={t('print.statement', { name: accountName })}
          details={[
            `${t('finance.year')}: ${t('finance.year_label', { from: String(year), to: String(year + 1) })}`,
          ]}
        >
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
        </Printable>
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
