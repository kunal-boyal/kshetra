import { formatNumber } from '@thelamp/i18n';
import {
  CopyTargetsResult,
  LockTargetsResult,
  type MetricView,
  PutTargetsResult,
  TargetListResult,
  type TargetSetResult,
  TargetSetResult as TargetSetSchema,
  targetValueIssue,
  todayIn,
  UNLOCK_REASON_MIN,
} from '@thelamp/shared';
import {
  Button,
  Confirm,
  EmptyState,
  Icon,
  StatusBadge,
  TextAreaField,
  TextField,
} from '@thelamp/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Lock, LockOpen, Save, Target } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { PageHeader, Section } from '../people/shared';

/** The month before a `YYYY-MM`. */
function previousMonth(period: string): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

function useTargets(period: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['targets', period],
    queryFn: () => read(client, `/v1/targets?period=${period}`, TargetListResult),
  });
}

type Edits = Record<string, Record<string, string>>;

/**
 * Targets (spec 5.8, 8.2): the month's grid of the people in the viewer's scope against each
 * targetable metric, with the team's totals beside the viewer's own target. Drafts are edited in
 * place and saved together; drafts are locked after asking (BR-08), copied from the month before,
 * and unlocked with a reason where the tenant allows it.
 */
export function TargetsPage() {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  const targets = useTargets(period);
  const [edits, setEdits] = useState<Edits>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<'lock' | 'copy' | null>(null);
  const [unlocking, setUnlocking] = useState<TargetSetResult | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [failure, setFailure] = useState<unknown>();
  const mayEdit = access.can('target.edit');
  const mayLock = access.can('target.lock');
  const mayUnlock = access.can('target.unlock');
  const data = targets.data;
  const metrics = data?.metrics ?? [];
  const number = (value: string | undefined) =>
    value === undefined ? '—' : formatNumber(Number(value), { locale });

  const changed = Object.entries(edits).filter(([, values]) => Object.keys(values).length > 0);
  const issues = new Map<string, string>();
  for (const [userId, values] of changed) {
    for (const [key, value] of Object.entries(values)) {
      const unit = metrics.find((metric) => metric.key === key)?.unit;
      const issue = value.trim() && unit ? targetValueIssue(unit, value) : null;
      if (issue) issues.set(`${userId}.${key}`, issue);
    }
  }

  async function act(work: () => Promise<string>) {
    setBusy(true);
    setMessage(undefined);
    setFailure(undefined);
    try {
      setMessage(await work());
      await queryClient.invalidateQueries({ queryKey: ['targets'] });
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    act(async () => {
      const sets = changed.map(([userId, values]) => ({
        userId,
        version: data!.sets.find((set) => set.user.id === userId)!.version,
        values: Object.fromEntries(
          Object.entries(values).map(([key, value]) => [key, value.trim() ? value.trim() : null]),
        ),
      }));
      await write(client, 'PUT', '/v1/targets', PutTargetsResult, { period, sets });
      setEdits({});
      return t('targets.saved', { count: sets.length });
    });

  const lock = () =>
    act(async () => {
      const result = await write(client, 'POST', '/v1/targets/lock', LockTargetsResult, {
        period,
        userIds: [...selected],
      });
      setAsking(null);
      setSelected(new Set());
      return t('targets.locked', { count: result?.locked.length ?? 0 });
    });

  const copy = () =>
    act(async () => {
      const result = await write(client, 'POST', '/v1/targets/copy', CopyTargetsResult, {
        period,
        from: previousMonth(period),
        userIds: [...selected],
      });
      setAsking(null);
      setSelected(new Set());
      return t('targets.copied', { count: result?.copied.length ?? 0 });
    });

  const unlock = (set: TargetSetResult) =>
    act(async () => {
      await write(client, 'POST', '/v1/targets/unlock', TargetSetSchema, {
        userId: set.user.id,
        period,
        reason,
      });
      setUnlocking(null);
      setReason('');
      return t('targets.unlocked', { name: set.user.name });
    });

  const cell = (set: TargetSetResult, metric: MetricView) => {
    const key = `${set.user.id}.${metric.key}`;
    const value = edits[set.user.id]?.[metric.key] ?? set.values[metric.key] ?? '';
    if (!mayEdit || set.status === 'locked') return number(set.values[metric.key]);
    return (
      <input
        className={issues.has(key) ? 'ks-input invalid' : 'ks-input'}
        aria-label={t('targets.value_for', {
          name: set.user.name,
          metric: metric.name[locale].one,
        })}
        aria-invalid={issues.has(key) ? true : undefined}
        inputMode="decimal"
        size={8}
        value={value}
        onChange={(event) =>
          setEdits((current) => ({
            ...current,
            [set.user.id]: { ...current[set.user.id], [metric.key]: event.target.value },
          }))
        }
      />
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('targets.title')} intro={t('targets.intro')} />
      <TextField
        label={t('plan.month')}
        type="month"
        className="max-w-xs"
        value={period}
        onChange={(event) => {
          if (!event.target.value) return;
          setPeriod(event.target.value);
          setEdits({});
          setSelected(new Set());
        }}
      />
      {message ? <p role="status">{message}</p> : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}

      {targets.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(targets.error, t)}
        </p>
      ) : !data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : metrics.length === 0 ? (
        <EmptyState icon={<Icon icon={Target} />} title={t('targets.no_metrics_title')}>
          {t('targets.no_metrics_body')}
        </EmptyState>
      ) : (
        <>
          {data.sets.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {mayEdit ? (
                <Button
                  variant="primary"
                  icon={<Icon icon={Save} />}
                  busy={busy}
                  disabled={changed.length === 0 || issues.size > 0}
                  onClick={() => void save()}
                >
                  {t('targets.save')}
                </Button>
              ) : null}
              {mayLock ? (
                <Button
                  icon={<Icon icon={Lock} />}
                  disabled={selected.size === 0}
                  onClick={() => setAsking('lock')}
                >
                  {t('targets.lock', { count: selected.size })}
                </Button>
              ) : null}
              {mayEdit ? (
                <Button
                  icon={<Icon icon={Copy} />}
                  disabled={selected.size === 0}
                  onClick={() => setAsking('copy')}
                >
                  {t('targets.copy', { count: selected.size })}
                </Button>
              ) : null}
            </div>
          ) : null}
          {asking ? (
            <Confirm
              question={t(asking === 'lock' ? 'targets.lock_question' : 'targets.copy_question', {
                count: selected.size,
                month: previousMonth(period),
              })}
              action={
                <Button
                  variant="primary"
                  busy={busy}
                  onClick={() => void (asking === 'lock' ? lock() : copy())}
                >
                  {t(asking === 'lock' ? 'targets.lock' : 'targets.copy', {
                    count: selected.size,
                  })}
                </Button>
              }
              cancel={
                <Button variant="secondary" onClick={() => setAsking(null)}>
                  {t('common.cancel')}
                </Button>
              }
            >
              {asking === 'lock' ? <p>{t('targets.lock_note')}</p> : null}
            </Confirm>
          ) : null}

          {issues.size > 0 ? (
            <ul className="ks-help error" role="alert">
              {[...issues].map(([key, issue]) => {
                const [userId, metricKey] = key.split('.') as [string, string];
                const person = data.sets.find((set) => set.user.id === userId)?.user.name ?? '';
                const metric = metrics.find((entry) => entry.key === metricKey);
                return (
                  <li key={key}>
                    {person}, {metric?.name[locale].one}: {issue}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className="w-full overflow-x-auto">
            <table className="ks-table">
              <caption className="sr-only">{t('targets.caption')}</caption>
              <thead>
                <tr>
                  {data.sets.length > 0 && (mayLock || mayEdit) ? (
                    <th scope="col">
                      <span className="sr-only">{t('targets.select')}</span>
                    </th>
                  ) : null}
                  <th scope="col">{t('targets.person')}</th>
                  {metrics.map((metric) => (
                    <th key={metric.key} scope="col" className="r">
                      {metric.name[locale].other}
                    </th>
                  ))}
                  <th scope="col">{t('targets.status')}</th>
                </tr>
              </thead>
              <tbody>
                {data.sets.map((set) => (
                  <tr key={set.user.id}>
                    {mayLock || mayEdit ? (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={t('targets.select_person', { name: set.user.name })}
                          checked={selected.has(set.user.id)}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(set.user.id);
                              else next.delete(set.user.id);
                              return next;
                            })
                          }
                        />
                      </td>
                    ) : null}
                    <th scope="row">
                      {set.user.name} <span className="ks-muted">{set.user.code}</span>
                    </th>
                    {metrics.map((metric) => (
                      <td key={metric.key} className="r">
                        {cell(set, metric)}
                      </td>
                    ))}
                    <td>
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          variant={
                            set.status === 'locked'
                              ? 'success'
                              : set.status === 'draft'
                                ? 'pending'
                                : 'neutral'
                          }
                        >
                          {t(`targets.status_${set.status}`)}
                        </StatusBadge>
                        {set.status === 'locked' && mayUnlock ? (
                          <Button
                            variant="ghost"
                            icon={<Icon icon={LockOpen} />}
                            onClick={() => setUnlocking(set)}
                          >
                            {t('targets.unlock')}
                          </Button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {data.sets.length > 0 ? (
                  <tr>
                    {mayLock || mayEdit ? <td /> : null}
                    <th scope="row">{t('targets.team_total')}</th>
                    {metrics.map((metric) => (
                      <td key={metric.key} className="r">
                        {number(data.totals[metric.key])}
                      </td>
                    ))}
                    <td />
                  </tr>
                ) : null}
                <tr>
                  {data.sets.length > 0 && (mayLock || mayEdit) ? <td /> : null}
                  <th scope="row">{t('targets.own')}</th>
                  {metrics.map((metric) => (
                    <td key={metric.key} className="r">
                      {number(data.own.values[metric.key])}
                    </td>
                  ))}
                  <td>
                    <StatusBadge variant={data.own.status === 'locked' ? 'success' : 'neutral'}>
                      {t(`targets.status_${data.own.status}`)}
                    </StatusBadge>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {unlocking ? (
        <Section title={t('targets.unlock_title', { name: unlocking.user.name })}>
          <TextAreaField
            label={t('targets.unlock_reason')}
            help={t('targets.unlock_help', { min: UNLOCK_REASON_MIN })}
            required
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              icon={<Icon icon={LockOpen} />}
              busy={busy}
              disabled={reason.trim().length < UNLOCK_REASON_MIN}
              onClick={() => void unlock(unlocking)}
            >
              {t('targets.unlock')}
            </Button>
            <Button variant="secondary" onClick={() => setUnlocking(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
