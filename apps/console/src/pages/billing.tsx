import { Link } from '@tanstack/react-router';
import { formatMoney } from '@thelamp/i18n';
import { Notice, SelectField, StatusBadge } from '@thelamp/ui-web';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { useBillingSettings, usePlans } from '../data';
import { useLanguage } from '../i18n';
import { InvoicesTable } from './invoices-table';

/** Every tenant's invoices, newest first, and the way to billing settings (decision D90). */
export function BillingPage() {
  const { t, locale } = useLanguage();
  const settings = useBillingSettings();
  const plans = usePlans();
  const [status, setStatus] = useState<'issued' | 'paid' | ''>('');
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="heading-xl">{t('console.billing')}</h1>
        <Link to="/billing/settings" className="ks-btn secondary">
          <Settings size={16} aria-hidden="true" />
          {t('console.billing_settings')}
        </Link>
      </div>
      {settings.data && !settings.data.ready ? (
        <Notice>{t('console.settings_not_ready')}</Notice>
      ) : settings.data?.example ? (
        <Notice>{t('console.settings_example')}</Notice>
      ) : null}
      {plans.data && plans.data.items.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-4">
          {plans.data.items
            .filter((plan) => plan.active || plan.tenants > 0)
            .map((plan) => (
              <Link
                key={plan.id}
                to="/plans/$planId"
                params={{ planId: plan.id }}
                className="ks-card act flex flex-col gap-2.5 text-inherit no-underline"
              >
                <span className="ks-spread">
                  <span className="heading-lg">{plan.name[locale]}</span>
                  <StatusBadge variant="neutral">
                    {t('console.plan_tenant_count', { count: plan.tenants })}
                  </StatusBadge>
                </span>
                <span className="font-semibold">
                  {t('console.plan_price', {
                    month: formatMoney(plan.priceMonth as `${number}`, { locale }),
                    year: formatMoney(plan.priceYear as `${number}`, { locale }),
                  })}
                </span>
                <span className="ks-meta">
                  {plan.modules.map((key) => t(`admin.module_${key}`)).join(' · ')}
                </span>
              </Link>
            ))}
        </div>
      ) : null}
      <SelectField
        className="self-start"
        label={t('console.col_status')}
        none={t('console.any_invoice')}
        value={status}
        onChange={(event) => setStatus(event.target.value as 'issued' | 'paid' | '')}
        options={[
          { value: 'issued', label: t('console.invoice_unpaid') },
          { value: 'paid', label: t('console.invoice_paid') },
        ]}
      />
      <InvoicesTable caption={t('console.invoices')} {...(status ? { status } : {})} />
      {settings.data ? (
        <Notice>
          {t('console.dunning_notice', {
            grace: settings.data.graceDays,
            readOnly: settings.data.readOnlyDays,
          })}
        </Notice>
      ) : null}
    </>
  );
}
