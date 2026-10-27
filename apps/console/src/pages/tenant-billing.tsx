import { emailMessage, formatDate, formatMoney } from '@thelamp/i18n';
import type { ConsoleTenant, TenantBillingResult } from '@thelamp/shared';
import {
  Button,
  Card,
  Confirm,
  Notice,
  SelectField,
  TextAreaField,
  TextField,
} from '@thelamp/ui-web';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useConsole } from '../context';
import { useConsoleMutations, usePlans, useTenantBilling } from '../data';
import { EmailField } from '../fields';
import { errorMessage, fieldErrors, useLanguage } from '../i18n';
import { STATE_OPTIONS } from './billing-settings';
import { InvoicesTable } from './invoices-table';
import { billingToday, holds } from './shared';

type Billing = TenantBillingResult;

function Facts({ facts }: { facts: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {facts.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-1">
          <dt className="ks-muted caption">{label}</dt>
          <dd className="m-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Failure({ message }: { message: string | undefined }) {
  return message ? (
    <p className="ks-help error" role="alert">
      {message}
    </p>
  ) : null;
}

/**
 * A tenant's billing in the console (decision D90): its details as a buyer, its subscription,
 * automatic payment, where it stands if unpaid, and its invoices.
 */
export function BillingCard({ tenant }: { tenant: ConsoleTenant }) {
  const { t } = useLanguage();
  const billing = useTenantBilling(tenant.id);
  if (billing.isError) {
    return (
      <Card>
        <p className="ks-help error" role="alert">
          {errorMessage(billing.error, t)}
        </p>
      </Card>
    );
  }
  if (!billing.data) return <p className="ks-muted">{t('common.loading')}</p>;
  return (
    <Card>
      <div className="flex flex-col gap-6">
        <h2 className="heading-md">{t('console.billing')}</h2>
        <DunningNotice billing={billing.data} />
        <AccountSection tenant={tenant} billing={billing.data} />
        <SubscriptionSection tenant={tenant} billing={billing.data} />
        {billing.data.account ? <MandateSection tenant={tenant} billing={billing.data} /> : null}
        <section className="flex flex-col gap-3">
          <h3 className="ks-label">{t('console.invoices')}</h3>
          <InvoicesTable tenantId={tenant.id} caption={t('console.invoices')} />
        </section>
      </div>
    </Card>
  );
}

function DunningNotice({ billing }: { billing: Billing }) {
  const { t, locale } = useLanguage();
  const { dunning } = billing;
  if (!dunning) return null;
  const day = (value: string) => formatDate(value, { locale });
  const text = t(`console.dunning_${dunning.stage}`, {
    since: day(dunning.overdueSince),
    readOnly: day(dunning.readOnlyOn),
    suspend: day(dunning.suspendOn),
  });
  return (
    <Notice>
      {text} {t('console.outstanding')}:{' '}
      {formatMoney(dunning.outstanding as `${number}`, { locale })}
    </Notice>
  );
}

function AccountSection({ tenant, billing }: { tenant: ConsoleTenant; billing: Billing }) {
  const { client } = useConsole();
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const manages = holds(client.staff, 'platform.billing.manage');
  const { account } = billing;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="ks-label">{t('console.billing_details')}</h3>
      {editing ? (
        <AccountForm tenant={tenant} billing={billing} onDone={() => setEditing(false)} />
      ) : (
        <>
          {account ? (
            <Facts
              facts={[
                [t('console.legal_name'), account.legalName],
                [t('console.gstin'), account.gstin ?? '—'],
                [t('console.address'), account.address],
                [
                  t('console.place_of_supply'),
                  STATE_OPTIONS.find((state) => state.value === account.stateCode)?.label ??
                    account.stateCode,
                ],
                [t('console.billing_email'), account.email],
                [t('console.language'), account.language === 'hi' ? 'हिन्दी' : 'English'],
              ]}
            />
          ) : (
            <p className="ks-muted">{t('console.no_billing_details')}</p>
          )}
          {manages ? (
            <Button variant="secondary" className="self-start" onClick={() => setEditing(true)}>
              {t(account ? 'console.edit_billing_details' : 'console.add_billing_details')}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

function AccountForm({
  tenant,
  billing,
  onDone,
}: {
  tenant: ConsoleTenant;
  billing: Billing;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const { saveBillingAccount } = useConsoleMutations();
  const [checked, setChecked] = useState(false);
  const [draft, setDraft] = useState({
    legalName: billing.account?.legalName ?? tenant.name,
    gstin: billing.account?.gstin ?? '',
    address: billing.account?.address ?? '',
    stateCode: billing.account?.stateCode ?? '27',
    email: billing.account?.email ?? '',
    language: billing.account?.language ?? ('en' as 'en' | 'hi'),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();
  const change = (patch: Partial<typeof draft>) => setDraft((now) => ({ ...now, ...patch }));

  async function save(event: FormEvent) {
    event.preventDefault();
    // A number or address that can't be one is explained here, before anything is sent (D102).
    if (emailMessage(draft.email, true)) {
      setChecked(true);
      return;
    }
    setErrors({});
    setFailure(undefined);
    try {
      await saveBillingAccount.mutateAsync({
        tenantId: tenant.id,
        body: {
          legalName: draft.legalName.trim(),
          gstin: draft.gstin.trim() || null,
          address: draft.address.trim(),
          stateCode: draft.stateCode,
          email: draft.email.trim(),
          language: draft.language,
        },
      });
      onDone();
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(errorMessage(error, t));
    }
  }

  return (
    <form className="flex max-w-xl flex-col gap-4" onSubmit={save} noValidate>
      <TextField
        label={t('console.legal_name')}
        value={draft.legalName}
        onChange={(event) => change({ legalName: event.target.value })}
        error={errors.legalName}
        required
      />
      <TextField
        label={t('console.gstin')}
        help={t('console.gstin_help')}
        value={draft.gstin}
        onChange={(event) => change({ gstin: event.target.value.toUpperCase() })}
        error={errors.gstin}
        autoComplete="off"
      />
      <TextAreaField
        label={t('console.address')}
        value={draft.address}
        onChange={(event) => change({ address: event.target.value })}
        error={errors.address}
        rows={3}
        required
      />
      <SelectField
        label={t('console.place_of_supply')}
        value={draft.stateCode}
        onChange={(event) => change({ stateCode: event.target.value })}
        options={STATE_OPTIONS}
        error={errors.stateCode}
      />
      <EmailField
        label={t('console.billing_email')}
        checked={checked}
        value={draft.email}
        onChange={(email) => change({ email })}
        error={errors.email}
        required
      />
      <SelectField
        label={t('console.language')}
        value={draft.language}
        onChange={(event) => change({ language: event.target.value as 'en' | 'hi' })}
        options={[
          { value: 'en', label: 'English' },
          { value: 'hi', label: 'हिन्दी' },
        ]}
      />
      <Failure message={failure} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" busy={saveBillingAccount.isPending}>
          {t('common.save')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function SubscriptionSection({ tenant, billing }: { tenant: ConsoleTenant; billing: Billing }) {
  const { client } = useConsole();
  const { t, locale } = useLanguage();
  const { cancelSubscription } = useConsoleMutations();
  const [mode, setMode] = useState<'view' | 'start' | 'change' | 'cancel'>('view');
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string>();
  const manages = holds(client.staff, 'platform.billing.manage');
  const { subscription } = billing;
  const day = (value: string) => formatDate(value, { locale });
  const running = subscription?.status === 'active';

  async function cancel() {
    setFailure(undefined);
    try {
      await cancelSubscription.mutateAsync({ tenantId: tenant.id, reason: reason.trim() });
      setMode('view');
      setReason('');
    } catch (error) {
      setFailure(errorMessage(error, t));
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="ks-label">{t('console.subscription')}</h3>
      {mode === 'start' || mode === 'change' ? (
        <SubscribeForm
          tenant={tenant}
          billing={billing}
          monthlyOnly={mode === 'change'}
          onDone={() => setMode('view')}
        />
      ) : subscription ? (
        <Facts
          facts={[
            [t('console.col_plan'), subscription.plan.name[locale]],
            [t('console.cycle'), t(`console.cycle_${subscription.cycle}`)],
            [t('console.started_on'), day(subscription.startedOn)],
            ...(subscription.term
              ? ([
                  [
                    t('console.term'),
                    t('console.term_value', {
                      from: day(subscription.term.from),
                      to: day(subscription.term.to),
                    }),
                  ],
                  [t('console.committed_seats'), String(subscription.committedSeats ?? '—')],
                ] as [string, ReactNode][])
              : []),
            ...(subscription.endsOn
              ? ([
                  [
                    running ? t('console.ends_on') : t('console.subscription_ended'),
                    day(subscription.endsOn),
                  ],
                ] as [string, ReactNode][])
              : []),
          ]}
        />
      ) : (
        <p className="ks-muted">{t('console.no_subscription')}</p>
      )}
      {mode === 'cancel' ? (
        <Confirm
          question={t('console.cancel_question', { name: tenant.name })}
          action={
            <Button
              variant="danger"
              busy={cancelSubscription.isPending}
              disabled={reason.trim().length < 3}
              onClick={() => void cancel()}
            >
              {t('console.cancel_subscription')}
            </Button>
          }
          cancel={
            <Button variant="ghost" onClick={() => setMode('view')}>
              {t('common.cancel')}
            </Button>
          }
        >
          <TextAreaField
            label={t('console.suspend_reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </Confirm>
      ) : null}
      <Failure message={failure} />
      {manages && mode === 'view' ? (
        <div className="flex flex-wrap gap-3">
          {!running || subscription?.endsOn ? (
            !running && billing.account ? (
              <Button variant="primary" onClick={() => setMode('start')}>
                {t('console.start_subscription')}
              </Button>
            ) : null
          ) : (
            <>
              {subscription?.cycle === 'month' ? (
                <Button variant="secondary" onClick={() => setMode('change')}>
                  {t('console.change_subscribed_plan')}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setMode('cancel')}>
                {t('console.cancel_subscription')}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function SubscribeForm({
  tenant,
  billing,
  monthlyOnly,
  onDone,
}: {
  tenant: ConsoleTenant;
  billing: Billing;
  monthlyOnly: boolean;
  onDone: () => void;
}) {
  const { t, locale } = useLanguage();
  const plans = usePlans();
  const { subscribe } = useConsoleMutations();
  const offered = (plans.data?.items ?? []).filter(
    (plan) => plan.active || plan.id === tenant.plan?.id,
  );
  const [planId, setPlanId] = useState(billing.subscription?.plan.id ?? tenant.plan?.id ?? '');
  const [cycle, setCycle] = useState<'month' | 'year'>('month');
  const [seats, setSeats] = useState(String(Math.max(tenant.activeUsers, 1)));
  const [startsOn, setStartsOn] = useState(billingToday);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();
  const chosen = planId || offered[0]?.id || '';

  async function save(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFailure(undefined);
    try {
      await subscribe.mutateAsync({
        tenantId: tenant.id,
        body: monthlyOnly
          ? { planId: chosen, cycle: 'month' }
          : {
              planId: chosen,
              cycle,
              committedSeats: cycle === 'year' ? Number(seats) : null,
              startsOn,
            },
      });
      onDone();
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(errorMessage(error, t));
    }
  }

  const price = (amount: string) => formatMoney(amount as `${number}`, { locale });
  return (
    <form className="flex max-w-xl flex-col gap-4" onSubmit={save} noValidate>
      <SelectField
        label={t('console.col_plan')}
        value={chosen}
        onChange={(event) => setPlanId(event.target.value)}
        options={offered.map((plan) => ({
          value: plan.id,
          label: t('console.plan_prices', {
            name: plan.name[locale],
            month: price(plan.priceMonth),
            year: price(plan.priceYear),
          }),
        }))}
        error={errors.planId}
      />
      {monthlyOnly ? null : (
        <>
          <SelectField
            label={t('console.cycle')}
            value={cycle}
            onChange={(event) => setCycle(event.target.value as 'month' | 'year')}
            options={[
              { value: 'month', label: t('console.cycle_month') },
              { value: 'year', label: t('console.cycle_year') },
            ]}
          />
          {cycle === 'year' ? (
            <TextField
              label={t('console.committed_seats')}
              numeric
              inputMode="numeric"
              value={seats}
              onChange={(event) => setSeats(event.target.value.replace(/\D/g, ''))}
              error={errors.committedSeats}
              required
            />
          ) : null}
          <TextField
            label={t('console.starts_on')}
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
            error={errors.startsOn}
            required
          />
        </>
      )}
      <Failure message={failure} />
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          variant="primary"
          busy={subscribe.isPending}
          disabled={!chosen || (cycle === 'year' && !monthlyOnly && !seats)}
        >
          {monthlyOnly ? t('common.save') : t('console.subscribe')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function MandateSection({ tenant, billing }: { tenant: ConsoleTenant; billing: Billing }) {
  const { client } = useConsole();
  const { t } = useLanguage();
  const { authorise } = useConsoleMutations();
  const [link, setLink] = useState<string | null>(null);
  const [failure, setFailure] = useState<string>();
  const mandate = billing.account?.mandate ?? 'none';

  async function setUp() {
    setFailure(undefined);
    try {
      const result = await authorise.mutateAsync(tenant.id);
      setLink(result.url);
    } catch (error) {
      setFailure(errorMessage(error, t));
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="ks-label">{t('console.automatic_payment')}</h3>
      <p>{t(`console.mandate_${mandate}`)}</p>
      {link ? (
        <p className="break-all">
          {t('console.mandate_link')} <a href={link}>{link}</a>
        </p>
      ) : null}
      <Failure message={failure} />
      {holds(client.staff, 'platform.billing.manage') && mandate !== 'active' ? (
        <Button
          variant="secondary"
          className="self-start"
          busy={authorise.isPending}
          onClick={() => void setUp()}
        >
          {t('console.set_up_mandate')}
        </Button>
      ) : null}
    </section>
  );
}
