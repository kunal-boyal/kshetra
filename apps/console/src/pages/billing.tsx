import { Link } from '@tanstack/react-router';
import { Notice, SelectField } from '@thelamp/ui-web';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { useBillingSettings } from '../data';
import { useLanguage } from '../i18n';
import { InvoicesTable } from './invoices-table';

/** Every tenant's invoices, newest first, and the way to billing settings (decision D90). */
export function BillingPage() {
  const { t } = useLanguage();
  const settings = useBillingSettings();
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
    </>
  );
}
