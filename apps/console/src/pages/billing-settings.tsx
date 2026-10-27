import { emailMessage } from '@thelamp/i18n';
import { Link } from '@tanstack/react-router';
import { type BillingSettingsResult, GST_STATES } from '@thelamp/shared';
import { Button, Card, Notice, SelectField, TextAreaField, TextField } from '@thelamp/ui-web';
import { ArrowLeft } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useConsole } from '../context';
import { useBillingSettings, useConsoleMutations } from '../data';
import { EmailField } from '../fields';
import { errorMessage, fieldErrors, useLanguage } from '../i18n';
import { holds } from './shared';

/** The states as the form offers them, by name. */
export const STATE_OPTIONS = Object.entries(GST_STATES)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

/** Who issues the vendor's invoices, and how unpaid tenants are followed up (decision D90). */
export function BillingSettingsPage() {
  const { t } = useLanguage();
  const settings = useBillingSettings();
  return (
    <>
      <Link to="/billing" className="ks-btn ghost sm self-start">
        <ArrowLeft size={16} aria-hidden="true" />
        {t('console.billing')}
      </Link>
      <h1 className="heading-xl">{t('console.billing_settings')}</h1>
      {settings.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(settings.error, t)}
        </p>
      ) : settings.data ? (
        <SettingsForm current={settings.data} />
      ) : (
        <p className="ks-muted">{t('common.loading')}</p>
      )}
    </>
  );
}

function SettingsForm({ current }: { current: BillingSettingsResult }) {
  const { client } = useConsole();
  const { t } = useLanguage();
  const { saveBillingSettings } = useConsoleMutations();
  const manages = holds(client.staff, 'platform.billing.manage');
  const [checked, setChecked] = useState(false);
  const [draft, setDraft] = useState({
    legalName: current.seller.legalName,
    gstin: current.seller.gstin ?? '',
    address: current.seller.address,
    stateCode: current.seller.stateCode,
    email: current.seller.email,
    sac: current.seller.sac,
    invoicePrefix: current.invoicePrefix,
    gstRate: current.gstRate,
    paymentTermsDays: String(current.paymentTermsDays),
    graceDays: String(current.graceDays),
    readOnlyDays: String(current.readOnlyDays),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();
  const [saved, setSaved] = useState(false);
  const change = (patch: Partial<typeof draft>) => {
    setSaved(false);
    setDraft((now) => ({ ...now, ...patch }));
  };
  const digits = (value: string) => value.replace(/\D/g, '');

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
      await saveBillingSettings.mutateAsync({
        seller: {
          legalName: draft.legalName.trim(),
          gstin: draft.gstin.trim() || null,
          address: draft.address.trim(),
          stateCode: draft.stateCode,
          email: draft.email.trim(),
          sac: draft.sac.trim(),
        },
        invoicePrefix: draft.invoicePrefix.trim(),
        gstRate: draft.gstRate.trim(),
        paymentTermsDays: Number(draft.paymentTermsDays),
        graceDays: Number(draft.graceDays),
        readOnlyDays: Number(draft.readOnlyDays),
      });
      setSaved(true);
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(errorMessage(error, t));
    }
  }

  return (
    <Card>
      <form className="flex max-w-xl flex-col gap-4" onSubmit={save} noValidate>
        {current.example ? <Notice>{t('console.settings_example')}</Notice> : null}
        <fieldset disabled={!manages} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          <h2 className="heading-md">{t('console.seller')}</h2>
          <TextField
            label={t('console.legal_name')}
            value={draft.legalName}
            onChange={(event) => change({ legalName: event.target.value })}
            error={errors['seller.legalName']}
            required
          />
          <TextField
            label={t('console.gstin')}
            help={t('console.gstin_help')}
            value={draft.gstin}
            onChange={(event) => change({ gstin: event.target.value.toUpperCase() })}
            error={errors['seller.gstin']}
            autoComplete="off"
          />
          <TextAreaField
            label={t('console.address')}
            value={draft.address}
            onChange={(event) => change({ address: event.target.value })}
            error={errors['seller.address']}
            rows={3}
            required
          />
          <SelectField
            label={t('console.state')}
            value={draft.stateCode}
            onChange={(event) => change({ stateCode: event.target.value })}
            options={STATE_OPTIONS}
            error={errors['seller.stateCode']}
          />
          <EmailField
            label={t('console.billing_email')}
            checked={checked}
            value={draft.email}
            onChange={(email) => change({ email })}
            error={errors['seller.email']}
            required
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextField
              label={t('console.sac')}
              help={t('console.sac_help')}
              numeric
              inputMode="numeric"
              value={draft.sac}
              onChange={(event) => change({ sac: digits(event.target.value) })}
              error={errors['seller.sac']}
              required
            />
            <TextField
              label={t('console.invoice_prefix')}
              help={t('console.invoice_prefix_help')}
              value={draft.invoicePrefix}
              onChange={(event) => change({ invoicePrefix: event.target.value.toUpperCase() })}
              error={errors.invoicePrefix}
              required
            />
            <TextField
              label={t('console.gst_rate')}
              numeric
              inputMode="decimal"
              value={draft.gstRate}
              onChange={(event) => change({ gstRate: event.target.value })}
              error={errors.gstRate}
              required
            />
          </div>
          <h2 className="heading-md">{t('console.dunning')}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextField
              label={t('console.payment_terms')}
              numeric
              inputMode="numeric"
              value={draft.paymentTermsDays}
              onChange={(event) => change({ paymentTermsDays: digits(event.target.value) })}
              error={errors.paymentTermsDays}
              required
            />
            <TextField
              label={t('console.grace_days')}
              numeric
              inputMode="numeric"
              value={draft.graceDays}
              onChange={(event) => change({ graceDays: digits(event.target.value) })}
              error={errors.graceDays}
              required
            />
            <TextField
              label={t('console.read_only_days')}
              numeric
              inputMode="numeric"
              value={draft.readOnlyDays}
              onChange={(event) => change({ readOnlyDays: digits(event.target.value) })}
              error={errors.readOnlyDays}
              required
            />
          </div>
        </fieldset>
        {failure ? (
          <p className="ks-help error" role="alert">
            {failure}
          </p>
        ) : null}
        {manages ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" busy={saveBillingSettings.isPending}>
              {t('console.save_settings')}
            </Button>
            {saved ? (
              <span className="ks-muted" role="status">
                {t('console.saved')}
              </span>
            ) : null}
          </div>
        ) : null}
      </form>
    </Card>
  );
}
