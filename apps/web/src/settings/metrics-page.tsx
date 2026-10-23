import type { MetricEntry, ScoreDefinition } from '@thelamp/metrics';
import {
  Button,
  type Column,
  DataTable,
  EmptyState,
  Icon,
  Notice,
  SelectField,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { Gauge, Plus, Save, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { fieldErrors, PageHeader, Section } from '../people/shared';
import { useMetricDefinitions, useSaveMetrics } from './metrics-data';

/**
 * Metrics and the score (M2, spec 5.7, 5.8): what is counted for each person each day, and how
 * the targeted ones weigh into the score that ranks people.
 */
export function MetricsPage() {
  const { t, locale } = useLanguage();
  const definitions = useMetricDefinitions();
  const columns: Column<MetricEntry>[] = [
    {
      key: 'name',
      header: t('people.name'),
      render: (entry) => (
        <Link
          to="/settings/metrics/$metricKey"
          params={{ metricKey: entry.definition.key }}
          className="font-semibold text-[var(--accent)]"
        >
          {entry.definition.name[locale].other}
        </Link>
      ),
    },
    { key: 'key', header: t('roles.key'), render: (entry) => <code>{entry.definition.key}</code> },
    {
      key: 'unit',
      header: t('metrics.unit'),
      render: (entry) => t(`metrics.unit_${entry.definition.unit}`),
    },
    {
      key: 'source',
      header: t('metrics.source'),
      render: (entry) => t(`metrics.source_${entry.definition.source.type}`),
    },
    {
      key: 'status',
      header: t('types.status'),
      render: (entry) =>
        entry.active ? (
          <StatusBadge variant="success">{t('types.in_use')}</StatusBadge>
        ) : (
          <StatusBadge variant="neutral">{t('metrics.retired')}</StatusBadge>
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('metrics.title')} intro={t('metrics.intro')}>
        <Link to="/settings/metrics/new" className="ks-btn primary">
          <Icon icon={Plus} />
          {t('metrics.add')}
        </Link>
      </PageHeader>
      {definitions.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(definitions.error, t)}
        </p>
      ) : definitions.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <>
          <DataTable
            caption={t('metrics.title')}
            columns={columns}
            rows={definitions.data.metrics}
            rowKey={(entry) => entry.definition.key}
            empty={
              <EmptyState icon={<Icon icon={Gauge} />} title={t('metrics.empty')}>
                {t('metrics.intro')}
              </EmptyState>
            }
          />
          <ScoreEditor
            key={JSON.stringify(definitions.data.score)}
            score={definitions.data.score}
            metrics={definitions.data.metrics.filter((entry) => entry.active)}
          />
        </>
      )}
    </div>
  );
}

interface WeightDraft {
  metric: string;
  weight: string;
}

/** The score's metrics and weights, and the cap on any one metric's attainment (BR-06). */
function ScoreEditor({
  score,
  metrics,
}: {
  score: ScoreDefinition | null;
  metrics: readonly MetricEntry[];
}) {
  const { t, locale } = useLanguage();
  const save = useSaveMetrics();
  const scorable = metrics.filter((entry) => entry.definition.targetable);
  const [weights, setWeights] = useState<WeightDraft[]>(() =>
    (score?.metrics ?? []).map((entry) => ({ metric: entry.metric, weight: String(entry.weight) })),
  );
  const [cap, setCap] = useState(() => String((score?.cap ?? 1) * 100));
  const [failure, setFailure] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);
  const total = weights.reduce((sum, entry) => sum + (Number(entry.weight) || 0), 0);
  const unused = scorable.filter(
    (entry) => !weights.some((weight) => weight.metric === entry.definition.key),
  );
  const change = (index: number, patch: Partial<WeightDraft>) =>
    setWeights(weights.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    setSaved(false);
    try {
      await save.score({
        periodType: 'month',
        rankingGroupBy: score?.rankingGroupBy ?? 'designation',
        cap: (Number(cap) || 100) / 100,
        metrics: weights.map((entry) => ({ metric: entry.metric, weight: Number(entry.weight) })),
      });
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('score.title')}>
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
        <p className="ks-muted text-sm">{t('score.intro')}</p>
        {saved ? <Notice>{t('common.saved')}</Notice> : null}
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
        {weights.map((entry, index) => {
          const metric = metrics.find((one) => one.definition.key === entry.metric);
          return (
            <div key={entry.metric} className="flex flex-wrap items-end gap-3">
              <span className="min-w-48 font-semibold">
                {metric?.definition.name[locale].other ?? entry.metric}
              </span>
              <TextField
                label={t('score.weight_of', {
                  name: metric?.definition.name[locale].other ?? entry.metric,
                })}
                type="number"
                inputMode="numeric"
                numeric
                value={entry.weight}
                {...(errors[`definition.metrics[${index}].weight`]
                  ? { error: errors[`definition.metrics[${index}].weight`] }
                  : {})}
                onChange={(event) => change(index, { weight: event.target.value })}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon icon={Trash2} size="sm" />}
                onClick={() => setWeights(weights.filter((_, at) => at !== index))}
              >
                {t('common.remove')}
              </Button>
            </div>
          );
        })}
        <p className="ks-muted text-sm" aria-live="polite">
          {t('score.total', { total: String(total) })}
        </p>
        {unused.length > 0 ? (
          <div className="flex flex-wrap items-end gap-3">
            <SelectField
              label={t('score.add')}
              value=""
              none={t('score.choose')}
              options={unused.map((entry) => ({
                value: entry.definition.key,
                label: entry.definition.name[locale].other,
              }))}
              onChange={(event) => {
                if (event.target.value) {
                  setWeights([...weights, { metric: event.target.value, weight: '10' }]);
                }
              }}
            />
          </div>
        ) : null}
        <TextField
          label={t('score.cap')}
          help={t('score.cap_help')}
          type="number"
          inputMode="numeric"
          numeric
          min={100}
          max={200}
          value={cap}
          {...(errors['definition.cap'] ? { error: errors['definition.cap'] } : {})}
          onChange={(event) => setCap(event.target.value)}
        />
        <p className="ks-muted text-sm">{t('score.monthly')}</p>
        <div>
          <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
            {t('score.save')}
          </Button>
        </div>
      </form>
    </Section>
  );
}
