import { LOCALES, type TenantSettings, type UpdateSettingsBody } from '@kshetra/shared';
import { Button, Checkbox, Icon, SelectField, TextField } from '@kshetra/ui-web';
import { Save } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { fieldErrors, PageHeader, Section } from '../people/shared';
import { useAdmin } from './data';

/** The settings this page edits; the organisation, branding and modules have their own pages. */
type Rules = Omit<
  TenantSettings,
  | 'legalName'
  | 'address'
  | 'taxId'
  | 'logoMediaId'
  | 'brandColour'
  | 'modulesOff'
  // Orders arrive in phase 2, with their settings.
  | 'ordersNeedOpenShift'
  | 'ordersAllowedOffline'
  // Review rules live on the review page.
  | 'reviewAutoApproval'
>;

type NumberKey = {
  [K in keyof Rules]: Rules[K] extends number ? K : never;
}[keyof Rules];
type FlagKey = { [K in keyof Rules]: Rules[K] extends boolean ? K : never }[keyof Rules];
type TimeKey = 'planNotificationTime' | 'quietHoursStart' | 'quietHoursEnd';

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

/** The time zones the browser knows, or the tenant's own when it lists none. */
function timeZones(current: string): string[] {
  const known =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return known.includes(current) ? known : [current, ...known];
}

/**
 * The tenant's rules (M2, spec 5.1): region and languages, field work, approvals, notifications,
 * retention and maps. One save sends what changed; the server checks every range.
 */
export function RulesPage() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const config = useConfig(client, queryClient);
  const admin = useAdmin();
  const settings = config.data?.bundle.settings;
  const [draft, setDraft] = useState<Partial<Record<keyof Rules, unknown>>>({});
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!settings) return <p className="ks-muted">{t('common.loading')}</p>;
  const errors = fieldErrors(error);
  const value = <K extends keyof Rules>(key: K): Rules[K] =>
    (key in draft ? draft[key] : settings[key]) as Rules[K];
  const set = (key: keyof Rules, next: unknown) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: next }));
  };

  const number = (key: NumberKey, min: number, max: number, unit: string) => (
    <TextField
      key={key}
      label={t(`admin.rule_${key}`)}
      help={t('admin.range', { min, max, unit })}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={String(value(key))}
      {...(errors[key] ? { error: errors[key] } : {})}
      onChange={(event) => set(key, event.target.value === '' ? '' : Number(event.target.value))}
    />
  );
  const flag = (key: FlagKey) => (
    <Checkbox
      key={key}
      label={t(`admin.rule_${key}`)}
      checked={value(key)}
      onChange={(event) => set(key, event.target.checked)}
    />
  );
  const time = (key: TimeKey) => (
    <TextField
      key={key}
      label={t(`admin.rule_${key}`)}
      type="time"
      value={value(key)}
      {...(errors[key] ? { error: errors[key] } : {})}
      onChange={(event) => set(key, event.target.value)}
    />
  );
  const group = (title: string, children: ReactNode) => (
    <Section title={title}>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </Section>
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    if (Object.keys(draft).length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      const patch = { ...draft } as Record<string, unknown>;
      if (patch.mapsWebKey === '') patch.mapsWebKey = null;
      await admin.saveSettings(patch as UpdateSettingsBody);
      setDraft({});
      setSaved(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const languages = value('languages');
  return (
    <form className="flex flex-col gap-6" onSubmit={save} aria-label={t('admin.rules')}>
      <PageHeader title={t('admin.rules')} intro={t('admin.rules_intro')} />
      {group(
        t('admin.rules_region'),
        <>
          <SelectField
            label={t('admin.rule_timezone')}
            value={value('timezone')}
            options={timeZones(value('timezone')).map((zone) => ({ value: zone, label: zone }))}
            {...(errors.timezone ? { error: errors.timezone } : {})}
            onChange={(event) => set('timezone', event.target.value)}
          />
          <TextField
            label={t('admin.rule_currency')}
            help={t('admin.rule_currency_help')}
            maxLength={3}
            value={value('currency')}
            {...(errors.currency ? { error: errors.currency } : {})}
            onChange={(event) => set('currency', event.target.value.toUpperCase())}
          />
          <TextField
            label={t('admin.rule_defaultCountry')}
            help={t('admin.rule_defaultCountry_help')}
            maxLength={2}
            value={value('defaultCountry')}
            {...(errors.defaultCountry ? { error: errors.defaultCountry } : {})}
            onChange={(event) => set('defaultCountry', event.target.value.toUpperCase())}
          />
          <SelectField
            label={t('admin.rule_financialYearStartMonth')}
            value={String(value('financialYearStartMonth'))}
            options={MONTHS.map((month) => ({
              value: String(month),
              label: new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
                new Date(Date.UTC(2026, month - 1, 1)),
              ),
            }))}
            onChange={(event) => set('financialYearStartMonth', Number(event.target.value))}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="ks-label">{t('admin.rule_languages')}</legend>
            {LOCALES.map((code) => (
              <Checkbox
                key={code}
                label={t(`admin.language_${code}`)}
                checked={languages.includes(code)}
                // English stays on: missing text falls back to it.
                disabled={code === 'en'}
                onChange={(event) =>
                  set(
                    'languages',
                    event.target.checked
                      ? [...languages, code]
                      : languages.filter((entry) => entry !== code),
                  )
                }
              />
            ))}
          </fieldset>
        </>,
      )}
      {group(
        t('admin.rules_field'),
        <>
          {number('gpsIntervalSeconds', 30, 900, t('admin.unit_seconds'))}
          {number('geofenceRadiusMeters', 50, 5000, t('admin.unit_metres'))}
          {number('geofenceAccuracyCapMeters', 0, 500, t('admin.unit_metres'))}
          {number('syncWindowHours', 24, 168, t('admin.unit_hours'))}
          {number('maxShiftHours', 8, 24, t('admin.unit_hours'))}
          {flag('attendanceSelfie')}
          {flag('deviceBinding')}
        </>,
      )}
      {group(
        t('admin.rules_approvals'),
        <>
          {flag('journeyPlanApproval')}
          {flag('targetUnlockByAdmin')}
        </>,
      )}
      {group(
        t('admin.rules_notifications'),
        <>
          {time('planNotificationTime')}
          {time('quietHoursStart')}
          {time('quietHoursEnd')}
        </>,
      )}
      {group(
        t('admin.rules_retention'),
        <>
          {number('rawLocationRetentionDays', 7, 90, t('admin.unit_days'))}
          {number('trailRetentionDays', 90, 1095, t('admin.unit_days'))}
          {number('evidencePhotoRetentionMonths', 3, 60, t('admin.unit_months'))}
        </>,
      )}
      {group(
        t('admin.rules_maps'),
        <TextField
          label={t('admin.rule_mapsWebKey')}
          help={t('admin.rule_mapsWebKey_help')}
          autoComplete="off"
          spellCheck={false}
          value={value('mapsWebKey') ?? ''}
          {...(errors.mapsWebKey ? { error: errors.mapsWebKey } : {})}
          onChange={(event) => set('mapsWebKey', event.target.value.trim())}
        />,
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={Object.keys(draft).length === 0}
          icon={<Icon icon={Save} />}
        >
          {t('common.save')}
        </Button>
        {saved ? (
          <span className="ks-help" role="status">
            {t('admin.saved')}
          </span>
        ) : null}
        {error !== undefined && Object.keys(errors).length === 0 ? (
          <span className="ks-help error" role="alert">
            {errorMessage(error, t)}
          </span>
        ) : null}
      </div>
    </form>
  );
}
