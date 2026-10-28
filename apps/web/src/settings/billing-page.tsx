import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  emailMessage,
  formatDate,
  formatMoney,
  formatMonth,
  formatNumber,
  localeTag,
} from '@thelamp/i18n';
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
  DescriptionList,
  Notice,
  SelectField,
  StatTile,
  StatusBadge,
  TextAreaField,
  TextField,
} from '@thelamp/ui-web';
import { Download } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { EmailField } from '../fields';
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
          <div className="flex flex-wrap items-stretch gap-4">
            <PlanHero billing={billing.data} />
            <Seats billing={billing.data} />
          </div>
          <div className="flex flex-wrap items-start gap-4">
            <InvoicesSection />
            <PaymentSection billing={billing.data} />
          </div>
          <SubscriptionSection billing={billing.data} />
          <DetailsSection billing={billing.data} />
          <UsageSection billing={billing.data} />
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
    /** "3 Oct", for a badge. */
    short: (value: string) =>
      new Intl.DateTimeFormat(localeTag(locale), {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date(`${value}T00:00:00Z`)),
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

/**
 * The plan as the prototype's hero draws it (decision D104): on the product's own Forest, since
 * the plan is the product's, with its cycle, price, renewal and modules.
 */
function PlanHero({ billing }: { billing: Billing }) {
  const { t, locale } = useLanguage();
  const { money, day } = useFormats();
  const { plan, subscription } = billing;
  const renewal = subscription?.endsOn
    ? t('billing.ends_on', { date: day(subscription.endsOn) })
    : subscription?.term
      ? t('billing.renews_on', { date: day(subscription.term.to) })
      : billing.trialEndsAt
        ? t('billing.trial_ends_on', {
            date: day(todayIn(BILLING_TIME_ZONE, new Date(billing.trialEndsAt))),
          })
        : null;
  const chip =
    'rounded-[var(--radius-full)] bg-[color-mix(in_srgb,var(--on-brand)_16%,transparent)] px-2.5 py-0.5 text-sm font-semibold';
  return (
    <section
      className="ks-card flex min-w-0 flex-[2_1_26rem] flex-col gap-3 border-0! bg-[var(--brand-forest)]! text-[var(--on-brand)]"
      aria-label={t('billing.plan')}
    >
      <div className="ks-spread">
        <h2 className="text-sm font-bold tracking-[.06em] uppercase opacity-85">
          {t('billing.your_plan')}
        </h2>
        {subscription ? (
          <span className={chip}>{t(`billing.cycle_short_${subscription.cycle}`)}</span>
        ) : null}
      </div>
      <p className="text-[2rem] leading-9 font-bold">
        {plan ? plan.name[locale] : t('billing.no_plan')}
      </p>
      {plan || renewal ? (
        <p className="opacity-90">
          {[
            ...(plan
              ? [
                  t('billing.price_value', {
                    month: money(plan.priceMonth),
                    year: money(plan.priceYear),
                  }),
                ]
              : []),
            ...(renewal ? [renewal] : []),
          ].join(' · ')}
        </p>
      ) : null}
      <ul className="flex flex-wrap gap-1.5" aria-label={t('billing.modules')}>
        {billing.modules.map((key) => (
          <li key={key} className={chip}>
            {t(`admin.module_${key}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The people the plan covers: a meter of the limit, or the count without one. */
function Seats({ billing }: { billing: Billing }) {
  const { t, locale } = useLanguage();
  const count = (value: number) => formatNumber(value, { locale });
  const { active, limit } = billing.people;
  return (
    <div className="flex min-w-0 flex-[1_1_16rem] [&>*]:flex-1">
      <StatTile
        label={t('billing.people')}
        value={
          limit === null
            ? t('billing.people_open', { active: count(active) })
            : t('billing.people_value', { active: count(active), limit: count(limit) })
        }
        {...(limit ? { meter: active / limit } : {})}
        {...(limit !== null && active > limit ? { tone: 'danger' as const } : {})}
        sub={
          limit === null
            ? t('billing.seats_open')
            : t('billing.seats_left', { count: count(Math.max(0, limit - active)) })
        }
      />
    </div>
  );
}

/** The subscription's terms: its cycle, start, term and commitment. */
function SubscriptionSection({ billing }: { billing: Billing }) {
  const { t, locale } = useLanguage();
  const { day } = useFormats();
  const { subscription } = billing;
  const count = (value: number) => formatNumber(value, { locale });
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
    <Section title={t('billing.subscription')}>
      {subscription ? <Facts items={term} /> : <p>{t('billing.no_subscription')}</p>}
    </Section>
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
    <Section title={t('billing.payment')} className="min-w-0 flex-[1_1_18rem]">
      <DescriptionList
        items={[
          [t('billing.how'), t(`billing.mandate_${mandate}`)],
          ...(billing.account
            ? ([
                [t('billing.bills_to'), billing.account.email],
                [t('billing.gstin'), billing.account.gstin ?? '—'],
              ] as [string, string][])
            : []),
        ]}
      />
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
  const [checked, setChecked] = useState(false);
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
    if (emailMessage(draft.email, true)) {
      setChecked(true);
      return;
    }
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
      <EmailField
        label={t('billing.email')}
        checked={checked}
        value={draft.email}
        onChange={(email) => change({ email })}
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
  const { money, day, short } = useFormats();
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

  /** When an invoice was paid in full: its last payment's day. */
  const paidOn = (row: InvoiceResult) =>
    row.payments
      .map((payment) => payment.receivedOn)
      .sort()
      .at(-1) ?? null;
  const columns: Column<InvoiceResult>[] = [
    { key: 'number', header: t('billing.col_number'), render: (row) => <code>{row.number}</code> },
    {
      key: 'period',
      header: t('billing.col_period'),
      render: (row) =>
        t('billing.period_value', { from: day(row.period.from), to: day(row.period.to) }),
    },
    {
      key: 'total',
      header: t('billing.col_total'),
      align: 'end',
      render: (row) => money(row.total),
    },
    {
      key: 'status',
      header: t('billing.col_status'),
      render: (row) => {
        const paid = row.status === 'paid' ? paidOn(row) : null;
        return row.status === 'paid' ? (
          <StatusBadge variant="success">
            {paid ? t('billing.paid_on', { date: short(paid) }) : t('billing.paid')}
          </StatusBadge>
        ) : row.dueOn < today ? (
          <StatusBadge variant="danger">{t('billing.overdue')}</StatusBadge>
        ) : (
          <StatusBadge variant="pending">
            {t('billing.due_on', { date: short(row.dueOn) })}
          </StatusBadge>
        );
      },
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
    <Section title={t('billing.invoices')} className="min-w-0 flex-[2_1_30rem]">
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
