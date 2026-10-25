import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatMoney, formatMonth, formatNumber } from '@thelamp/i18n';
import {
  BILLING_TIME_ZONE,
  GST_STATES,
  InvoiceListResult,
  type InvoiceResult,
  MandateResult,
  PortalBillingResult,
  todayIn,
} from '@thelamp/shared';
import {
  Button,
  type Column,
  DataTable,
  Notice,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
} from '@thelamp/ui-web';
import { Download } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, write } from '../people/data';
import { Facts, fieldErrors, PageHeader, Section } from '../people/shared';

type Billing = PortalBillingResult;

const STATES = Object.entries(GST_STATES)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

function useBilling() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['billing'],
    queryFn: () => read(client, '/v1/billing', PortalBillingResult),
  });
}

/**
 * Billing for tenant admins (spec M23, decision D90): the plan and the people it covers, where
 * the organisation stands if a payment is overdue, how it pays, its billing details, its usage,
 * and its invoices as PDFs. Only `billing.manage` reaches it.
 */
export function BillingPage() {
  const { t } = useLanguage();
  const billing = useBilling();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('billing.title')} intro={t('billing.intro')} />
      {billing.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(billing.error, t)}
        </p>
      ) : !billing.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <>
          <Standing billing={billing.data} />
          <PlanSection billing={billing.data} />
          <PaymentSection billing={billing.data} />
          <DetailsSection billing={billing.data} />
          <UsageSection billing={billing.data} />
          <InvoicesSection />
        </>
      )}
    </div>
  );
}

function useFormats() {
  const { locale } = useLanguage();
  return {
    money: (amount: string) => formatMoney(amount as `${number}`, { locale }),
    day: (value: string) => formatDate(value, { locale }),
  };
}

/** Where the organisation stands while a payment is overdue (BR-48). */
function Standing({ billing }: { billing: Billing }) {
  const { t } = useLanguage();
  const { money, day } = useFormats();
  const { dunning } = billing;
  if (!dunning) return null;
  return (
    <Notice>
      {t(`billing.standing_${dunning.stage}`, {
        amount: money(dunning.outstanding),
        since: day(dunning.overdueSince),
        readOnly: day(dunning.readOnlyOn),
        suspend: day(dunning.suspendOn),
      })}
    </Notice>
  );
}

function PlanSection({ billing }: { billing: Billing }) {
  const { t, locale } = useLanguage();
  const { money, day } = useFormats();
  const { plan, people, subscription } = billing;
  const count = (value: number) => formatNumber(value, { locale });
  const facts: [string, string][] = [
    [t('billing.plan'), plan ? plan.name[locale] : t('billing.no_plan')],
    ...(plan
      ? ([
          [
            t('billing.price'),
            t('billing.price_value', {
              month: money(plan.priceMonth),
              year: money(plan.priceYear),
            }),
          ],
        ] as [string, string][])
      : []),
    [
      t('billing.people'),
      people.limit === null
        ? t('billing.people_open', { active: count(people.active) })
        : t('billing.people_value', { active: count(people.active), limit: count(people.limit) }),
    ],
    [t('billing.modules'), billing.modules.map((key) => t(`admin.module_${key}`)).join(', ')],
    ...(billing.trialEndsAt
      ? ([
          [t('billing.trial_ends'), day(todayIn(BILLING_TIME_ZONE, new Date(billing.trialEndsAt)))],
        ] as [string, string][])
      : []),
  ];
  const term: [string, string][] = subscription
    ? [
        [t('billing.cycle'), t(`billing.cycle_${subscription.cycle}`)],
        [t('billing.started'), day(subscription.startedOn)],
        ...(subscription.term
          ? ([
              [
                t('billing.term'),
                t('billing.period_value', {
                  from: day(subscription.term.from),
                  to: day(subscription.term.to),
                }),
              ],
              [t('billing.committed'), count(subscription.committedSeats ?? 0)],
            ] as [string, string][])
          : []),
        ...(subscription.endsOn
          ? ([[t('billing.ends'), day(subscription.endsOn)]] as [string, string][])
          : []),
      ]
    : [];
  return (
    <>
      <Section title={t('billing.plan')}>
        <Facts items={facts} />
      </Section>
      <Section title={t('billing.subscription')}>
        {subscription ? <Facts items={term} /> : <p>{t('billing.no_subscription')}</p>}
      </Section>
    </>
  );
}

function PaymentSection({ billing }: { billing: Billing }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [link, setLink] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const mandate = billing.account?.mandate ?? 'none';

  async function setUp() {
    setBusy(true);
    setFailure(undefined);
    try {
      const result = await write(client, 'POST', '/v1/billing/mandate', MandateResult);
      setLink(result?.url ?? null);
      await queryClient.invalidateQueries({ queryKey: ['billing'] });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('billing.payment')}>
      <p>{t(`billing.mandate_${mandate}`)}</p>
      {!billing.automaticPayment ? (
        <p className="ks-muted">{t('billing.automatic_soon')}</p>
      ) : billing.account && mandate !== 'active' ? (
        <Button variant="secondary" className="self-start" busy={busy} onClick={() => void setUp()}>
          {t('billing.set_up')}
        </Button>
      ) : null}
      {link ? (
        <a className="ks-btn primary self-start" href={link}>
          {t('billing.authorise')}
        </a>
      ) : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
    </Section>
  );
}

function DetailsSection({ billing }: { billing: Billing }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const { account } = billing;
  return (
    <Section title={t('billing.details')}>
      <p className="ks-muted">{t('billing.details_intro')}</p>
      {editing ? (
        <DetailsForm billing={billing} onDone={() => setEditing(false)} />
      ) : (
        <>
          {account ? (
            <Facts
              items={[
                [t('billing.legal_name'), account.legalName],
                [t('billing.gstin'), account.gstin ?? '—'],
                [t('billing.address'), account.address],
                [t('billing.state'), GST_STATES[account.stateCode] ?? account.stateCode],
                [t('billing.email'), account.email],
                [t('billing.language'), account.language === 'hi' ? 'हिन्दी' : 'English'],
              ]}
            />
          ) : (
            <p>{t('billing.no_details')}</p>
          )}
          <Button variant="secondary" className="self-start" onClick={() => setEditing(true)}>
            {t(account ? 'billing.edit' : 'billing.add')}
          </Button>
        </>
      )}
    </Section>
  );
}

function DetailsForm({ billing, onDone }: { billing: Billing; onDone: () => void }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [draft, setDraft] = useState({
    legalName: billing.account?.legalName ?? '',
    gstin: billing.account?.gstin ?? '',
    address: billing.account?.address ?? '',
    stateCode: billing.account?.stateCode ?? '27',
    email: billing.account?.email ?? '',
    language: billing.account?.language ?? ('en' as 'en' | 'hi'),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const change = (patch: Partial<typeof draft>) => setDraft((now) => ({ ...now, ...patch }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFailure(undefined);
    try {
      const saved = await write(client, 'PUT', '/v1/billing/account', PortalBillingResult, {
        legalName: draft.legalName.trim(),
        gstin: draft.gstin.trim() || null,
        address: draft.address.trim(),
        stateCode: draft.stateCode,
        email: draft.email.trim(),
        language: draft.language,
      });
      queryClient.setQueryData(['billing'], saved);
      onDone();
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex max-w-xl flex-col gap-4" onSubmit={save} noValidate>
      <TextField
        label={t('billing.legal_name')}
        value={draft.legalName}
        onChange={(event) => change({ legalName: event.target.value })}
        error={errors.legalName}
        required
      />
      <TextField
        label={t('billing.gstin')}
        help={t('billing.gstin_help')}
        value={draft.gstin}
        onChange={(event) => change({ gstin: event.target.value.toUpperCase() })}
        error={errors.gstin}
        autoComplete="off"
      />
      <TextAreaField
        label={t('billing.address')}
        value={draft.address}
        onChange={(event) => change({ address: event.target.value })}
        error={errors.address}
        rows={3}
        required
      />
      <SelectField
        label={t('billing.state')}
        value={draft.stateCode}
        onChange={(event) => change({ stateCode: event.target.value })}
        options={STATES}
        error={errors.stateCode}
      />
      <TextField
        label={t('billing.email')}
        type="email"
        value={draft.email}
        onChange={(event) => change({ email: event.target.value })}
        error={errors.email}
        required
      />
      <SelectField
        label={t('billing.language')}
        value={draft.language}
        onChange={(event) => change({ language: event.target.value as 'en' | 'hi' })}
        options={[
          { value: 'en', label: 'English' },
          { value: 'hi', label: 'हिन्दी' },
        ]}
      />
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" busy={busy}>
          {t('billing.save')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

type UsageRow = Billing['usage'][number];

function UsageSection({ billing }: { billing: Billing }) {
  const { t, locale } = useLanguage();
  const figure = (value: string | undefined, digits = 2) =>
    value === undefined
      ? '—'
      : formatNumber(value as `${number}`, { locale }, { maximumFractionDigits: digits });
  const storage = (value: string | undefined) => {
    if (value === undefined) return '—';
    const bytes = Number(value);
    const gb = bytes >= 1024 ** 3;
    return formatNumber(
      bytes / 1024 ** (gb ? 3 : 2),
      { locale },
      {
        style: 'unit',
        unit: gb ? 'gigabyte' : 'megabyte',
        maximumFractionDigits: 1,
      },
    );
  };
  const columns: Column<UsageRow>[] = [
    {
      key: 'month',
      header: t('billing.col_month'),
      render: (row) => formatMonth(row.period, { locale }),
    },
    {
      key: 'seats',
      header: t('billing.usage_seats'),
      align: 'end',
      render: (row) => figure(row.metrics.seats),
    },
    {
      key: 'sms',
      header: t('billing.usage_sms'),
      align: 'end',
      render: (row) => figure(row.metrics.sms, 0),
    },
    {
      key: 'whatsapp',
      header: t('billing.usage_whatsapp'),
      align: 'end',
      render: (row) => figure(row.metrics.whatsapp, 0),
    },
    {
      key: 'storage',
      header: t('billing.usage_storage'),
      align: 'end',
      render: (row) => storage(row.metrics.storage_bytes),
    },
  ];
  if (billing.usage.length === 0) return null;
  return (
    <Section title={t('billing.usage')}>
      <DataTable
        caption={t('billing.usage')}
        columns={columns}
        rows={billing.usage}
        rowKey={(row) => row.period}
      />
    </Section>
  );
}

function InvoicesSection() {
  const { client } = useApp();
  const { t } = useLanguage();
  const { money, day } = useFormats();
  const [failure, setFailure] = useState<unknown>();
  const invoices = useInfiniteQuery({
    queryKey: ['billing-invoices'],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/billing/invoices?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        InvoiceListResult,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const today = todayIn(BILLING_TIME_ZONE, new Date());

  async function download(invoice: InvoiceResult) {
    setFailure(undefined);
    try {
      const file = await client.file(`/v1/billing/invoices/${invoice.id}/pdf`);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${invoice.number.replaceAll('/', '-')}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFailure(error);
    }
  }

  const columns: Column<InvoiceResult>[] = [
    { key: 'number', header: t('billing.col_number'), render: (row) => row.number },
    {
      key: 'period',
      header: t('billing.col_period'),
      render: (row) =>
        t('billing.period_value', { from: day(row.period.from), to: day(row.period.to) }),
    },
    { key: 'issued', header: t('billing.col_issued'), render: (row) => day(row.issuedOn) },
    { key: 'due', header: t('billing.col_due'), render: (row) => day(row.dueOn) },
    {
      key: 'total',
      header: t('billing.col_total'),
      align: 'end',
      render: (row) => money(row.total),
    },
    {
      key: 'status',
      header: t('billing.col_status'),
      render: (row) =>
        row.status === 'paid' ? (
          <StatusBadge variant="success">{t('billing.paid')}</StatusBadge>
        ) : row.dueOn < today ? (
          <StatusBadge variant="danger">{t('billing.overdue')}</StatusBadge>
        ) : (
          <StatusBadge variant="pending">{t('billing.unpaid')}</StatusBadge>
        ),
    },
    {
      key: 'file',
      header: t('billing.col_file'),
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          icon={<Download size={16} aria-hidden="true" />}
          aria-label={t('billing.download_label', { number: row.number })}
          onClick={() => void download(row)}
        >
          {t('billing.download')}
        </Button>
      ),
    },
  ];

  return (
    <Section title={t('billing.invoices')}>
      {invoices.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(invoices.error, t)}
        </p>
      ) : !invoices.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('billing.invoices')}
          columns={columns}
          rows={invoices.data.pages.flatMap((page) => page.items)}
          rowKey={(row) => row.id}
          empty={<p className="ks-muted">{t('billing.no_invoices')}</p>}
          {...(invoices.hasNextPage
            ? {
                more: {
                  label: t('common.load_more'),
                  busy: invoices.isFetchingNextPage,
                  onClick: () => void invoices.fetchNextPage(),
                },
              }
            : {})}
        />
      )}
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
    </Section>
  );
}
