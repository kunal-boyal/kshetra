import {
  type AgeingBucket,
  ANOMALY_FLAGS,
  bucketsIssue,
  BURST_COUNT,
  BURST_WINDOW_MS,
  FAST_TRAVEL_KMH,
  LOCALES,
  MOCK_HISTORY_DAYS,
  PHOTO_FAR_M,
  type TenantSettings,
  type UpdateSettingsBody,
} from '@thelamp/shared';
import { Button, Checkbox, Icon, SelectField, TextField } from '@thelamp/ui-web';
import { Plus, Save, Trash2 } from 'lucide-react';
import { formatNumber } from '@thelamp/i18n';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { fieldErrors, PageHeader, Section } from '../people/shared';
import { useAdmin } from './data';
import { useMetricDefinitions } from './metrics-data';

/** The settings this page edits; the organisation, branding and modules have their own pages. */
type Rules = Omit<
  TenantSettings,
  | 'legalName'
  | 'address'
  | 'taxId'
  | 'logoMediaId'
  | 'privacyPolicyUrl'
  | 'brandColour'
  | 'modulesOff'
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
export function timeZones(current: string): string[] {
  const known =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return known.includes(current) ? known : [current, ...known];
}

/**
 * The tenant's rules (M2, spec 5.1): region and languages, field work, approvals, orders, account
 * finance, notifications, retention and maps; a module's rules show while it is on. One save sends
 * what changed; the server checks every range, and the ageing buckets are checked here first.
 */
export function RulesPage() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const config = useConfig(client, queryClient);
  const admin = useAdmin();
  const settings = config.data?.bundle.settings;
  const metrics = useMetricDefinitions();
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

  const bucketsWrong = 'ageingBuckets' in draft && bucketsIssue(value('ageingBuckets')) !== null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (Object.keys(draft).length === 0 || bucketsWrong) return;
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
  const checksOff = value('anomalyFlagsOff');
  // What each evidence check's label names: its fixed threshold (BR-50).
  const thresholds = {
    distance: formatNumber(PHOTO_FAR_M, { locale }),
    speed: formatNumber(FAST_TRAVEL_KMH, { locale }),
    count: formatNumber(BURST_COUNT, { locale }),
    minutes: formatNumber(BURST_WINDOW_MS / 60_000, { locale }),
    days: formatNumber(MOCK_HISTORY_DAYS, { locale }),
  };
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
          <SelectField
            label={t('admin.rule_odometer')}
            help={t('admin.rule_odometer_help')}
            value={value('odometer')}
            options={(['off', 'optional', 'required'] as const).map((choice) => ({
              value: choice,
              label: t(`admin.odometer_${choice}`),
            }))}
            onChange={(event) => set('odometer', event.target.value)}
          />
          {flag('deviceBinding')}
        </>,
      )}
      {settings.modulesOff.includes('orders')
        ? null
        : group(
            t('orders.title'),
            <>
              {flag('ordersNeedOpenShift')}
              {flag('ordersAllowedOffline')}
            </>,
          )}
      {group(
        t('admin.rules_approvals'),
        <>
          {flag('journeyPlanApproval')}
          {flag('targetUnlockByAdmin')}
          {number('defaultCreditDays', 0, 365, t('admin.unit_days'))}
        </>,
      )}
      <Section title={t('admin.rules_evidence')}>
        <p className="ks-help">{t('admin.rules_evidence_help')}</p>
        <div className="grid gap-4 md:grid-cols-2">
          {ANOMALY_FLAGS.map((check) => (
            <Checkbox
              key={check}
              label={t(`admin.anomaly_${check}`, thresholds)}
              checked={!checksOff.includes(check)}
              onChange={(event) =>
                set(
                  'anomalyFlagsOff',
                  event.target.checked
                    ? checksOff.filter((entry) => entry !== check)
                    : [...checksOff, check],
                )
              }
            />
          ))}
        </div>
      </Section>
      {group(
        t('forecast.title'),
        <SelectField
          label={t('admin.rule_forecastPlanMetric')}
          help={t('admin.rule_forecastPlanMetric_help')}
          value={value('forecastPlanMetric') ?? ''}
          none={t('admin.rule_forecastPlanMetric_none')}
          options={(metrics.data?.metrics ?? [])
            .filter((entry) => entry.active && entry.definition.unit === 'currency')
            .map((entry) => ({
              value: entry.definition.key,
              label: entry.definition.name[locale].other,
            }))}
          {...(errors.forecastPlanMetric ? { error: errors.forecastPlanMetric } : {})}
          onChange={(event) => set('forecastPlanMetric', event.target.value || null)}
        />,
      )}
      {settings.modulesOff.includes('account_finance')
        ? null
        : group(
            t('collections.title'),
            <TextField
              label={t('admin.rule_collectionCashLimit')}
              help={t('admin.rule_collectionCashLimit_help')}
              inputMode="decimal"
              value={value('collectionCashLimit') ?? ''}
              {...(errors.collectionCashLimit ? { error: errors.collectionCashLimit } : {})}
              onChange={(event) =>
                set(
                  'collectionCashLimit',
                  event.target.value.trim() === '' ? null : event.target.value.trim(),
                )
              }
            />,
          )}
      {settings.modulesOff.includes('account_finance') ? null : (
        <Section title={t('finance.ageing')}>
          <AgeingBuckets
            buckets={value('ageingBuckets')}
            error={
              bucketsWrong
                ? t('admin.buckets_issue')
                : Object.entries(errors).find(([path]) => path.startsWith('ageingBuckets'))?.[1]
            }
            onChange={(next) => set('ageingBuckets', next)}
          />
        </Section>
      )}
      {settings.modulesOff.includes('inventory')
        ? null
        : group(
            t('stock.title'),
            <>
              <SelectField
                label={t('admin.rule_stockSource')}
                help={t('admin.rule_stockSource_help')}
                value={value('stockSource')}
                options={(['kept', 'books'] as const).map((source) => ({
                  value: source,
                  label: t(`admin.rule_stockSource_${source}`),
                }))}
                {...(errors.stockSource ? { error: errors.stockSource } : {})}
                onChange={(event) => set('stockSource', event.target.value)}
              />
              {number('countTolerancePct', 0, 100, '%')}
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
          {number('notificationRetentionDays', 30, 365, t('admin.unit_days'))}
          {number('importFileRetentionDays', 7, 180, t('admin.unit_days'))}
          {number('auditRetentionYears', 1, 7, t('admin.unit_years'))}
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
          disabled={Object.keys(draft).length === 0 || bucketsWrong}
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

/** The most bands an organisation may age into (spec 5.1, M11). */
const MOST_BUCKETS = 8;

/**
 * The bands of days past due that account finance ages outstanding into (BR-20): each from a day
 * and to a day, the last with no end. A band keeps its key, which its stored amounts carry; a new
 * band's key comes from its first day.
 */
function AgeingBuckets({
  buckets,
  error,
  onChange,
}: {
  buckets: readonly AgeingBucket[];
  error: string | undefined;
  onChange: (buckets: AgeingBucket[]) => void;
}) {
  const { t } = useLanguage();
  const days = (text: string) => (text === '' ? null : Number(text));
  const change = (index: number, next: Partial<AgeingBucket>) =>
    onChange(buckets.map((bucket, i) => (i === index ? { ...bucket, ...next } : bucket)));
  /** A band after the last: an open last band gets 30 days, and the new one has no end. */
  function add() {
    const last = buckets.at(-1)!;
    const end = last.toDays ?? last.fromDays + 29;
    const from = end + 1;
    const taken = new Set(buckets.map((bucket) => bucket.key));
    let key = `d${from}`;
    for (let n = 2; taken.has(key); n += 1) key = `d${from}_${n}`;
    onChange([
      ...buckets.slice(0, -1),
      { ...last, toDays: end },
      { key, fromDays: from, toDays: null },
    ]);
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="ks-help">{t('admin.buckets_help')}</p>
      {buckets.map((bucket, index) => (
        <fieldset key={bucket.key} className="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto]">
          <legend className="ks-label">{t('admin.bucket_n', { n: index + 1 })}</legend>
          <TextField
            label={t('admin.bucket_from')}
            type="number"
            inputMode="numeric"
            min={0}
            max={3650}
            value={String(bucket.fromDays)}
            onChange={(event) => change(index, { fromDays: Number(event.target.value) || 0 })}
          />
          <TextField
            label={t('admin.bucket_to')}
            help={t('admin.bucket_to_help')}
            type="number"
            inputMode="numeric"
            min={0}
            max={3650}
            value={bucket.toDays === null ? '' : String(bucket.toDays)}
            onChange={(event) => change(index, { toDays: days(event.target.value) })}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={buckets.length === 1}
            icon={<Icon icon={Trash2} />}
            aria-label={t('admin.bucket_remove', { n: index + 1 })}
            onClick={() => onChange(buckets.filter((_, i) => i !== index))}
          />
        </fieldset>
      ))}
      {error ? (
        <p className="ks-help error" role="alert">
          {error}
        </p>
      ) : null}
      {buckets.length < MOST_BUCKETS ? (
        <Button size="sm" className="self-start" icon={<Icon icon={Plus} />} onClick={add}>
          {t('admin.bucket_add')}
        </Button>
      ) : null}
    </div>
  );
}
