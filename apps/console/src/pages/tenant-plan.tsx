import { formatMonth, formatNumber } from '@thelamp/i18n';
import {
  type ConsoleTenant,
  SWITCHABLE_MODULES,
  type SwitchableModule,
  type TenantEntitlements,
  type TenantUsageResult,
  USAGE_METRICS,
  type UsageMetric,
} from '@thelamp/shared';
import {
  Button,
  Card,
  Checkbox,
  ChoiceGroup,
  type Column,
  DataTable,
  EmptyState,
  SelectField,
  TextField,
} from '@thelamp/ui-web';
import { ChartColumn } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useConsole } from '../context';
import { useConsoleMutations, useEntitlements, usePlans, useUsage } from '../data';
import { errorMessage, fieldErrors, useLanguage } from '../i18n';
import { holds, moduleName } from './shared';

type Limit = 'users' | 'storageGb';
type LimitMode = 'plan' | 'none' | 'own';
type Translate = ReturnType<typeof useLanguage>['t'];

/** A tenant's plan, the modules open to it and its caps, and changing them (decision D89). */
export function PlanCard({ tenant }: { tenant: ConsoleTenant }) {
  const { client } = useConsole();
  const { t, locale } = useLanguage();
  const entitlements = useEntitlements(tenant.id);
  const [editing, setEditing] = useState(false);
  const manages = holds(client.staff, 'platform.plan.manage');

  if (entitlements.isError) {
    return (
      <Card>
        <p className="ks-help error" role="alert">
          {errorMessage(entitlements.error, t)}
        </p>
      </Card>
    );
  }
  if (!entitlements.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const now = entitlements.data;
  const limit = (value: number | null, show: (value: number) => string) =>
    value === null ? t('console.no_limit') : show(value);
  const facts: [string, string][] = [
    [t('console.col_plan'), now.plan ? now.plan.name[locale] : t('console.no_plan_open')],
    [t('console.modules_open'), now.modules.map((key) => moduleName(key, t)).join(', ')],
    ...(now.plan
      ? ([
          [
            t('console.extra_modules'),
            now.extraModules.length
              ? now.extraModules.map((key) => moduleName(key, t)).join(', ')
              : t('common.none'),
          ],
        ] as [string, string][])
      : []),
    [
      t('console.people_limit'),
      limit(now.limits.users, (users) =>
        t('console.people_in_use', {
          used: formatNumber(tenant.activeUsers, { locale }),
          limit: formatNumber(users, { locale }),
        }),
      ),
    ],
    [
      t('console.storage_limit'),
      limit(now.limits.storageGb, (gb) =>
        t('console.gigabytes', { value: formatNumber(gb, { locale }) }),
      ),
    ],
  ];

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <h2 className="heading-md">{t('console.col_plan')}</h2>
        {editing ? (
          <PlanEditor tenant={tenant} now={now} onDone={() => setEditing(false)} />
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map(([label, value]) => (
                <div key={label} className="flex flex-col gap-1">
                  <dt className="ks-muted caption">{label}</dt>
                  <dd className="m-0">{value}</dd>
                </div>
              ))}
            </dl>
            {manages ? (
              <Button variant="secondary" className="self-start" onClick={() => setEditing(true)}>
                {t('console.change_plan')}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}

function modeOf(own: TenantEntitlements['ownLimits'], key: Limit): LimitMode {
  if (own[key] === undefined) return 'plan';
  return own[key] === null ? 'none' : 'own';
}

function PlanEditor({
  tenant,
  now,
  onDone,
}: {
  tenant: ConsoleTenant;
  now: TenantEntitlements;
  onDone: () => void;
}) {
  const { t, locale } = useLanguage();
  const plans = usePlans();
  const { setPlan } = useConsoleMutations();
  const [planId, setPlanId] = useState(now.plan?.id ?? '');
  const [extra, setExtra] = useState<SwitchableModule[]>(now.extraModules);
  const [modes, setModes] = useState<Record<Limit, LimitMode>>({
    users: modeOf(now.ownLimits, 'users'),
    storageGb: modeOf(now.ownLimits, 'storageGb'),
  });
  const [values, setValues] = useState<Record<Limit, string>>({
    users: now.ownLimits.users?.toString() ?? '',
    storageGb: now.ownLimits.storageGb?.toString() ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();

  const items = plans.data?.items ?? [];
  const chosen = items.find((plan) => plan.id === planId);
  // A switched-off plan stays on offer only to a tenant already on it.
  const offered = items.filter((plan) => plan.active || plan.id === now.plan?.id);
  const beyond = SWITCHABLE_MODULES.filter((key) => !chosen?.modules.includes(key));

  async function save(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFailure(undefined);
    const limits: { users?: number | null; storageGb?: number | null } = {};
    for (const key of ['users', 'storageGb'] as const) {
      if (modes[key] === 'none') limits[key] = null;
      if (modes[key] === 'own') limits[key] = Number(values[key]);
    }
    try {
      await setPlan.mutateAsync({
        tenantId: tenant.id,
        body: {
          planId: planId || null,
          extraModules: chosen ? extra.filter((key) => beyond.includes(key)) : [],
          limits,
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
      <SelectField
        label={t('console.col_plan')}
        none={t('console.no_plan_option')}
        value={planId}
        onChange={(event) => setPlanId(event.target.value)}
        options={offered.map((plan) => ({
          value: plan.id,
          label: plan.active
            ? plan.name[locale]
            : t('console.plan_switched_off', { name: plan.name[locale] }),
        }))}
        error={errors.planId}
      />
      {chosen && beyond.length ? (
        <ChoiceGroup legend={t('console.extra_modules')} error={errors.extraModules}>
          <p className="ks-help">{t('console.extra_modules_help')}</p>
          {beyond.map((key) => (
            <Checkbox
              key={key}
              label={moduleName(key, t)}
              checked={extra.includes(key)}
              onChange={(event) =>
                setExtra((current) =>
                  event.target.checked
                    ? [...current, key]
                    : current.filter((module) => module !== key),
                )
              }
            />
          ))}
        </ChoiceGroup>
      ) : null}
      {(['users', 'storageGb'] as const).map((key) => (
        <LimitField
          key={key}
          label={t(key === 'users' ? 'console.people_limit' : 'console.storage_limit')}
          valueLabel={t(
            key === 'users' ? 'console.limit_people_value' : 'console.limit_storage_value',
          )}
          planValue={
            chosen?.limits[key] == null ? null : formatNumber(chosen.limits[key], { locale })
          }
          mode={modes[key]}
          onMode={(mode) => setModes((current) => ({ ...current, [key]: mode }))}
          value={values[key]}
          onValue={(value) => setValues((current) => ({ ...current, [key]: value }))}
          error={errors[`limits.${key}`]}
          t={t}
        />
      ))}
      {failure ? (
        <p className="ks-help error" role="alert">
          {failure}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          variant="primary"
          busy={setPlan.isPending}
          disabled={(['users', 'storageGb'] as const).some(
            (key) => modes[key] === 'own' && !values[key],
          )}
        >
          {t('common.save')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** A cap that follows the plan, is lifted, or is this tenant's own number. */
function LimitField({
  label,
  valueLabel,
  planValue,
  mode,
  onMode,
  value,
  onValue,
  error,
  t,
}: {
  label: string;
  valueLabel: string;
  /** The plan's cap, or null when it has none. */
  planValue: string | null;
  mode: LimitMode;
  onMode: (mode: LimitMode) => void;
  value: string;
  onValue: (value: string) => void;
  error: string | undefined;
  t: Translate;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
      <SelectField
        label={label}
        value={mode}
        onChange={(event) => onMode(event.target.value as LimitMode)}
        options={[
          {
            value: 'plan',
            label:
              planValue === null
                ? t('console.limit_follow_open')
                : t('console.limit_follow', { value: planValue }),
          },
          { value: 'none', label: t('console.limit_none') },
          { value: 'own', label: t('console.limit_own') },
        ]}
        {...(mode === 'own' ? {} : { error })}
      />
      {mode === 'own' ? (
        <TextField
          label={valueLabel}
          numeric
          inputMode="numeric"
          value={value}
          onChange={(event) => onValue(event.target.value.replace(/\D/g, ''))}
          error={error}
          required
        />
      ) : null}
    </div>
  );
}

/** Figures for one metric, in the reader's numbers: storage in MB or GB, seats to 2 places. */
function figure(metric: UsageMetric, value: string | undefined, locale: 'en' | 'hi'): string {
  if (value === undefined) return '—';
  if (metric === 'storage_bytes') {
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
  }
  return formatNumber(value as `${number}`, { locale }, { maximumFractionDigits: 2 });
}

type UsageRow = TenantUsageResult['items'][number];

/** A tenant's metered usage for its last six months, newest first (M22, BR-45). */
export function UsageCard({ tenantId }: { tenantId: string }) {
  const { t, locale } = useLanguage();
  const usage = useUsage(tenantId);
  const columns: Column<UsageRow>[] = [
    {
      key: 'period',
      header: t('console.col_month'),
      render: (row) => formatMonth(row.period, { locale }),
    },
    ...USAGE_METRICS.map((metric): Column<UsageRow> => ({
      key: metric,
      header: t(`console.usage_${metric}`),
      align: 'end',
      render: (row) => figure(metric, row.metrics[metric], locale),
    })),
  ];
  return (
    <Card>
      <div className="flex flex-col gap-4">
        <h2 className="heading-md">{t('console.usage')}</h2>
        <p className="ks-muted">{t('console.usage_intro')}</p>
        {usage.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(usage.error, t)}
          </p>
        ) : usage.isPending ? (
          <p className="ks-muted">{t('common.loading')}</p>
        ) : (
          <DataTable
            caption={t('console.usage')}
            columns={columns}
            rows={usage.data.items}
            rowKey={(row) => row.period}
            empty={
              <EmptyState icon={<ChartColumn aria-hidden="true" />} title={t('console.usage')}>
                {t('console.no_usage')}
              </EmptyState>
            }
          />
        )}
      </div>
    </Card>
  );
}
