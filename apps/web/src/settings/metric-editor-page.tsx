import {
  METRIC_UNITS,
  type MetricDefinition,
  type MetricEntry,
  type MetricSource,
  type MetricSourceType,
  RECOMPUTE_MAX_DAYS,
} from '@thelamp/metrics';
import { ORDER_STATUSES, todayIn } from '@thelamp/shared';
import { Button, Checkbox, ChoiceGroup, Icon, SelectField, TextField } from '@thelamp/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { Save } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useForms } from '../forms/data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess, useRoles } from '../people/data';
import { fieldErrors, PageHeader, Section } from '../people/shared';
import { useMetricDefinitions, useSaveMetrics } from './metrics-data';
import { useTypeList } from './types-data';

type Param =
  | 'forms'
  | 'field'
  | 'column'
  | 'accountTypes'
  | 'segment'
  | 'aggregate'
  | 'statuses'
  | 'amount'
  | 'measure'
  | 'accountType'
  | 'numerator'
  | 'denominator';

/** What each source type of spec 5.7 asks for. */
const PARAMS: Record<MetricSourceType, readonly Param[]> = {
  submission_count: ['forms'],
  submission_field_sum: ['forms', 'field'],
  product_line_sum: ['forms', 'field', 'column'],
  distinct_accounts_visited: ['forms', 'accountTypes', 'segment'],
  coverage_percent: ['forms', 'accountTypes', 'segment'],
  frequency_compliance_percent: ['forms', 'accountTypes'],
  plan_compliance_percent: [],
  visit_duration: ['aggregate', 'accountTypes'],
  order_value: ['statuses', 'amount'],
  order_quantity: ['statuses', 'measure'],
  productive_visits: ['accountTypes'],
  order_lines: ['statuses'],
  active_days: ['forms'],
  new_accounts: ['accountType'],
  external: [],
  ratio: ['numerator', 'denominator'],
};
const SOURCE_TYPES = Object.keys(PARAMS) as MetricSourceType[];
const CHOICES = {
  column: ['quantity', 'value'],
  aggregate: ['sum', 'average'],
  amount: ['before_tax', 'after_tax'],
  measure: ['base_units', 'kg', 'L'],
} as const;

interface SourceDraft {
  type: MetricSourceType;
  forms: string[];
  field: string;
  column: string;
  accountTypes: string[];
  segment: string;
  aggregate: string;
  statuses: string[];
  amount: string;
  measure: string;
  accountType: string;
  numerator: string;
  denominator: string;
  where: unknown;
}

interface MetricDraft {
  key: string;
  oneEn: string;
  otherEn: string;
  oneHi: string;
  otherHi: string;
  unit: MetricDefinition['unit'];
  direction: MetricDefinition['direction'];
  targetable: boolean;
  visibleRoles: string[];
  active: boolean;
  from: string;
  source: SourceDraft;
}

function draftOf(entry: MetricEntry | undefined, today: string): MetricDraft {
  const definition = entry?.definition;
  const source = (definition?.source ?? { type: 'submission_count' }) as Partial<
    Record<string, unknown>
  > & { type: MetricSourceType };
  const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
  const keys = (value: unknown) => (Array.isArray(value) ? (value as string[]) : []);
  return {
    key: definition?.key ?? '',
    oneEn: definition?.name.en.one ?? '',
    otherEn: definition?.name.en.other ?? '',
    oneHi: definition?.name.hi.one ?? '',
    otherHi: definition?.name.hi.other ?? '',
    unit: definition?.unit ?? 'count',
    direction: definition?.direction ?? 'higher_is_better',
    targetable: definition?.targetable ?? true,
    visibleRoles: [...(definition?.visibleRoles ?? [])],
    active: entry?.active ?? true,
    from: today,
    source: {
      type: source.type,
      forms: keys(source.forms),
      field: text(source.field, ''),
      column: text(source.column, 'value'),
      accountTypes: keys(source.accountTypes),
      segment: text(source.segment, ''),
      aggregate: text(source.aggregate, 'sum'),
      statuses:
        keys(source.statuses).length > 0 ? keys(source.statuses) : ['accepted', 'fulfilled'],
      amount: text(source.amount, 'before_tax'),
      measure: text(source.measure, 'base_units'),
      accountType: text(source.accountType, ''),
      numerator: text(source.numerator, ''),
      denominator: text(source.denominator, ''),
      where: source.where,
    },
  };
}

/** The source as the API checks it: only what its type asks for, empty lists left out. */
function sourceOf(draft: SourceDraft): MetricSource {
  const source: Record<string, unknown> = { type: draft.type };
  for (const param of PARAMS[draft.type]) {
    const value = draft[param];
    if (Array.isArray(value) ? value.length > 0 : value !== '') source[param] = value;
  }
  if (draft.type === 'submission_count' && draft.where !== undefined) source.where = draft.where;
  return source as MetricSource;
}

function definitionOf(draft: MetricDraft): MetricDefinition {
  return {
    key: draft.key.trim(),
    name: {
      en: { one: draft.oneEn.trim(), other: draft.otherEn.trim() },
      hi: {
        one: draft.oneHi.trim() || draft.oneEn.trim(),
        other: draft.otherHi.trim() || draft.otherEn.trim(),
      },
    },
    unit: draft.unit,
    direction: draft.direction,
    source: sourceOf(draft.source),
    targetable: draft.targetable,
    ...(draft.visibleRoles.length > 0 ? { visibleRoles: draft.visibleRoles } : {}),
  };
}

/** The date `days` before a `YYYY-MM-DD` date. */
function daysBefore(date: string, days: number): string {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() - days);
  return moment.toISOString().slice(0, 10);
}

/**
 * One metric (M2, spec 5.7): its names, where its values come from, who sees it and whether it
 * carries targets. A metric keeps its key and unit; a change works people's facts out again from
 * the chosen day, which may be up to three months back.
 */
export function MetricEditorPage({ metricKey }: { metricKey?: string }) {
  const { t } = useLanguage();
  const definitions = useMetricDefinitions();
  if (definitions.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(definitions.error, t)}
      </p>
    );
  }
  if (!definitions.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const entry = metricKey
    ? definitions.data.metrics.find((one) => one.definition.key === metricKey)
    : undefined;
  if (metricKey && !entry) return <p className="ks-muted">{t('metrics.not_found')}</p>;
  return (
    <Editor
      key={metricKey ?? 'new'}
      entry={entry}
      others={definitions.data.metrics.filter((one) => one.definition.key !== metricKey)}
    />
  );
}

function Editor({
  entry,
  others,
}: {
  entry: MetricEntry | undefined;
  others: readonly MetricEntry[];
}) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const navigate = useNavigate();
  const save = useSaveMetrics();
  const forms = useForms();
  const types = useTypeList();
  const roles = useRoles();
  const today = todayIn(access.timezone);
  const [draft, setDraft] = useState(() => draftOf(entry, today));
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);
  const at = (path: string) => (errors[path] ? { error: errors[path] } : {});
  const set = (patch: Partial<MetricDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const setSource = (patch: Partial<SourceDraft>) =>
    setDraft((current) => ({ ...current, source: { ...current.source, ...patch } }));
  const params = PARAMS[draft.source.type];
  const editing = entry !== undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      const definition = definitionOf(draft);
      if (editing) {
        await save.update(definition.key, { definition, active: draft.active, from: draft.from });
      } else {
        await save.create(definition);
      }
      await navigate({ to: '/settings/metrics' });
    } catch (caught) {
      setFailure(caught);
      setBusy(false);
    }
  }

  const many = (
    param: 'forms' | 'accountTypes' | 'statuses',
    legend: string,
    options: readonly { value: string; label: string }[],
  ) => (
    <ChoiceGroup key={param} legend={legend} {...at(`definition.source.${param}`)}>
      <div className="flex flex-wrap gap-3">
        {options.map((option) => (
          <Checkbox
            key={option.value}
            label={option.label}
            checked={draft.source[param].includes(option.value)}
            onChange={(event) =>
              setSource({
                [param]: event.target.checked
                  ? [...draft.source[param], option.value]
                  : draft.source[param].filter((value) => value !== option.value),
              })
            }
          />
        ))}
      </div>
    </ChoiceGroup>
  );
  const one = (
    param: Param & keyof SourceDraft,
    label: string,
    options: readonly { value: string; label: string }[],
    none?: string,
  ) => (
    <SelectField
      key={param}
      label={label}
      value={draft.source[param] as string}
      options={options}
      {...(none === undefined ? {} : { none })}
      {...at(`definition.source.${param}`)}
      onChange={(event) => setSource({ [param]: event.target.value })}
    />
  );
  const formOptions = (forms.data ?? []).map((form) => ({
    value: form.key,
    label: form.name[locale].other,
  }));
  const typeOptions = (types.data ?? []).map((type) => ({
    value: type.key,
    label: type.name[locale].other,
  }));
  const metricOptions = others
    .filter((other) => other.active && other.definition.source.type !== 'ratio')
    .map((other) => ({ value: other.definition.key, label: other.definition.name[locale].other }));
  const controls: Record<Param, () => ReactNode> = {
    forms: () => many('forms', t('metrics.forms'), formOptions),
    field: () => (
      <TextField
        key="field"
        label={t('metrics.field')}
        help={t('metrics.field_help')}
        value={draft.source.field}
        {...at('definition.source.field')}
        onChange={(event) => setSource({ field: event.target.value })}
      />
    ),
    column: () =>
      one(
        'column',
        t('metrics.column'),
        CHOICES.column.map((value) => ({ value, label: t(`metrics.column_${value}`) })),
      ),
    accountTypes: () => many('accountTypes', t('metrics.account_types'), typeOptions),
    segment: () => (
      <TextField
        key="segment"
        label={t('metrics.segment')}
        help={t('metrics.segment_help')}
        value={draft.source.segment}
        {...at('definition.source.segment')}
        onChange={(event) => setSource({ segment: event.target.value })}
      />
    ),
    aggregate: () =>
      one(
        'aggregate',
        t('metrics.aggregate'),
        CHOICES.aggregate.map((value) => ({ value, label: t(`metrics.aggregate_${value}`) })),
      ),
    statuses: () =>
      many(
        'statuses',
        t('metrics.statuses'),
        ORDER_STATUSES.map((value) => ({ value, label: t(`metrics.status_${value}`) })),
      ),
    amount: () =>
      one(
        'amount',
        t('metrics.amount'),
        CHOICES.amount.map((value) => ({ value, label: t(`metrics.amount_${value}`) })),
      ),
    measure: () =>
      one(
        'measure',
        t('metrics.measure'),
        CHOICES.measure.map((value) => ({ value, label: t(`metrics.measure_${value}`) })),
      ),
    accountType: () =>
      one('accountType', t('metrics.account_type'), typeOptions, t('score.choose')),
    numerator: () => one('numerator', t('metrics.numerator'), metricOptions, t('score.choose')),
    denominator: () =>
      one('denominator', t('metrics.denominator'), metricOptions, t('score.choose')),
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => void submit(event)} noValidate>
      <PageHeader
        title={entry ? entry.definition.name[locale].other : t('metrics.add')}
        back={{ to: '/settings/metrics', label: t('metrics.title') }}
      />
      {failure !== undefined ? (
        <div className="ks-help error" role="alert">
          <p>{errorMessage(failure, t)}</p>
          <ul>
            {Object.entries(errors).map(([path, issue]) => (
              <li key={path}>
                <code>{path}</code>: {issue}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Section title={t('types.names')}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label={t('types.key')}
            help={t('metrics.key_help')}
            required
            readOnly={editing}
            value={draft.key}
            {...at('definition.key')}
            onChange={(event) => set({ key: event.target.value })}
          />
          <SelectField
            label={t('metrics.unit')}
            help={editing ? t('metrics.unit_kept') : t('metrics.unit_help')}
            disabled={editing}
            value={draft.unit}
            options={METRIC_UNITS.map((value) => ({ value, label: t(`metrics.unit_${value}`) }))}
            {...at('definition.unit')}
            onChange={(event) => set({ unit: event.target.value as MetricDraft['unit'] })}
          />
          <TextField
            label={t('types.one_en')}
            required
            value={draft.oneEn}
            {...at('definition.name.en.one')}
            onChange={(event) => set({ oneEn: event.target.value })}
          />
          <TextField
            label={t('types.other_en')}
            required
            value={draft.otherEn}
            {...at('definition.name.en.other')}
            onChange={(event) => set({ otherEn: event.target.value })}
          />
          <TextField
            label={t('types.one_hi')}
            value={draft.oneHi}
            onChange={(event) => set({ oneHi: event.target.value })}
          />
          <TextField
            label={t('types.other_hi')}
            value={draft.otherHi}
            onChange={(event) => set({ otherHi: event.target.value })}
          />
          <SelectField
            label={t('metrics.direction')}
            value={draft.direction}
            options={(['higher_is_better', 'lower_is_better'] as const).map((value) => ({
              value,
              label: t(`metrics.direction_${value}`),
            }))}
            onChange={(event) => set({ direction: event.target.value as MetricDraft['direction'] })}
          />
        </div>
        <Checkbox
          label={t('metrics.targetable')}
          checked={draft.targetable}
          onChange={(event) => set({ targetable: event.target.checked })}
        />
        <ChoiceGroup legend={t('metrics.visible_roles')} {...at('definition.visibleRoles')}>
          <p className="ks-help">{t('metrics.visible_roles_help')}</p>
          <div className="flex flex-wrap gap-3">
            {(roles.data ?? []).map((role) => (
              <Checkbox
                key={role.key}
                label={role.name[locale]}
                checked={draft.visibleRoles.includes(role.key)}
                onChange={(event) =>
                  set({
                    visibleRoles: event.target.checked
                      ? [...draft.visibleRoles, role.key]
                      : draft.visibleRoles.filter((key) => key !== role.key),
                  })
                }
              />
            ))}
          </div>
        </ChoiceGroup>
      </Section>

      <Section title={t('metrics.source')}>
        <SelectField
          label={t('metrics.source_type')}
          value={draft.source.type}
          options={SOURCE_TYPES.map((value) => ({ value, label: t(`metrics.source_${value}`) }))}
          {...at('definition.source.type')}
          onChange={(event) => setSource({ type: event.target.value as MetricSourceType })}
        />
        <p className="ks-muted text-sm">{t(`metrics.about_${draft.source.type}`)}</p>
        {params.map((param) => controls[param]())}
        {draft.source.type === 'submission_count' && draft.source.where !== undefined ? (
          <p className="ks-muted text-sm">{t('metrics.where_kept')}</p>
        ) : null}
      </Section>

      {editing ? (
        <Section title={t('metrics.apply')}>
          <Checkbox
            label={t('metrics.active')}
            checked={draft.active}
            onChange={(event) => set({ active: event.target.checked })}
          />
          {errors.active ? (
            <p className="ks-help error" role="alert">
              {errors.active}
            </p>
          ) : null}
          <TextField
            label={t('metrics.from')}
            help={t('metrics.from_help', { days: String(RECOMPUTE_MAX_DAYS) })}
            type="date"
            min={daysBefore(today, RECOMPUTE_MAX_DAYS)}
            max={today}
            value={draft.from}
            {...at('from')}
            onChange={(event) => set({ from: event.target.value })}
          />
        </Section>
      ) : (
        <p className="ks-muted text-sm">{t('metrics.new_from')}</p>
      )}

      <div>
        <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
          {editing ? t('metrics.save') : t('metrics.create')}
        </Button>
      </div>
    </form>
  );
}
