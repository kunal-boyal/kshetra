import { formatMonth, localeTag } from '@thelamp/i18n';
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
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Lock,
  LockOpen,
  RotateCcw,
  Save,
  Target,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { PageHeader, Section } from '../people/shared';
import { useFigure } from '../performance/shared';

/** The month `step` months from a `YYYY-MM`. */
function shiftMonth(period: string, step: number): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const index = year * 12 + (month - 1) + step;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The month before a `YYYY-MM`. */
const previousMonth = (period: string) => shiftMonth(period, -1);

const STATUS_BADGE = { locked: 'success', draft: 'pending', none: 'neutral' } as const;

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
  const figure = useFigure();
  const shown = (metric: MetricView, value: string | undefined) => figure(metric, value ?? null);
  const currencySymbol =
    new Intl.NumberFormat(localeTag(locale), { style: 'currency', currency: access.currency })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? '';
  /** What a metric's values are counted in, beside its heading and inside its fields. */
  const unitOf = (metric: MetricView): { text: string; end: boolean } | null =>
    metric.unit === 'currency'
      ? { text: currencySymbol, end: false }
      : metric.unit === 'percent'
        ? { text: '%', end: true }
        : metric.unit === 'duration'
          ? { text: t('targets.unit_minutes'), end: true }
          : null;
  const counts = { locked: 0, draft: 0, none: 0 };
  for (const set of data?.sets ?? []) counts[set.status] += 1;
  const selectable = (data?.sets.length ?? 0) > 0 && (mayLock || mayEdit);
  const everyone = data?.sets.map((set) => set.user.id) ?? [];
  const allSelected = everyone.length > 0 && everyone.every((id) => selected.has(id));
  const goTo = (next: string) => {
    setPeriod(next);
    setEdits({});
    setSelected(new Set());
    setMessage(undefined);
  };

  const changed = Object.entries(edits).filter(([, values]) => Object.keys(values).length > 0);
  const editCount = changed.reduce((sum, [, values]) => sum + Object.keys(values).length, 0);
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
    const edited = edits[set.user.id]?.[metric.key];
    if (!mayEdit || set.status === 'locked') return shown(metric, set.values[metric.key]);
    const unit = unitOf(metric);
    const invalid = issues.has(key);
    const changedHere = edited !== undefined && edited !== (set.values[metric.key] ?? '');
    const input = (
      <input
        className={`ks-input num${invalid ? ' invalid' : changedHere ? ' changed' : ''}`}
        aria-label={t('targets.value_for', {
          name: set.user.name,
          metric: metric.name[locale].one,
        })}
        aria-invalid={invalid ? true : undefined}
        inputMode="decimal"
        placeholder="—"
        value={edited ?? set.values[metric.key] ?? ''}
        onChange={(event) =>
          setEdits((current) => ({
            ...current,
            [set.user.id]: { ...current[set.user.id], [metric.key]: event.target.value },
          }))
        }
      />
    );
    return unit ? (
      <span className={unit.end ? 'ks-affix end' : 'ks-affix'}>
        <span aria-hidden="true">{unit.text}</span>
        {input}
      </span>
    ) : (
      input
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('targets.title')} intro={t('targets.intro')} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-end gap-2">
          <Button
            variant="secondary"
            icon={<Icon icon={ChevronLeft} />}
            aria-label={t('targets.previous_month')}
            onClick={() => goTo(shiftMonth(period, -1))}
          />
          <TextField
            label={t('plan.month')}
            type="month"
            className="max-w-[12rem]"
            value={period}
            onChange={(event) => {
              if (event.target.value) goTo(event.target.value);
            }}
          />
          <Button
            variant="secondary"
            icon={<Icon icon={ChevronRight} />}
            aria-label={t('targets.next_month')}
            onClick={() => goTo(shiftMonth(period, 1))}
          />
        </div>
        {data && data.sets.length > 0 ? (
          <p
            className="flex flex-wrap items-center gap-2"
            aria-label={formatMonth(period, { locale })}
          >
            <span className="ks-muted">{t('targets.people', { count: data.sets.length })}</span>
            <StatusBadge variant="success">
              {t('targets.count_locked', { count: counts.locked })}
            </StatusBadge>
            <StatusBadge variant="pending">
              {t('targets.count_draft', { count: counts.draft })}
            </StatusBadge>
            <StatusBadge variant="neutral">
              {t('targets.count_none', { count: counts.none })}
            </StatusBadge>
          </p>
        ) : null}
      </div>
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
          {(mayEdit && changed.length > 0) || selected.size > 0 ? (
            <div className="ks-card flex flex-wrap items-center justify-between gap-3">
              <span className="flex flex-wrap gap-x-4 gap-y-1 font-semibold">
                {mayEdit && changed.length > 0 ? (
                  <span>{t('targets.unsaved', { count: editCount })}</span>
                ) : null}
                {selected.size > 0 ? (
                  <span>{t('targets.selected', { count: selected.size })}</span>
                ) : null}
              </span>
              <span className="flex flex-wrap gap-2">
                {selected.size > 0 ? (
                  <>
                    {mayLock ? (
                      <Button icon={<Icon icon={Lock} />} onClick={() => setAsking('lock')}>
                        {t('targets.lock', { count: selected.size })}
                      </Button>
                    ) : null}
                    {mayEdit ? (
                      <Button icon={<Icon icon={Copy} />} onClick={() => setAsking('copy')}>
                        {t('targets.copy', { count: selected.size })}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      icon={<Icon icon={X} />}
                      onClick={() => setSelected(new Set())}
                    >
                      {t('targets.clear_selection')}
                    </Button>
                  </>
                ) : null}
                {mayEdit && changed.length > 0 ? (
                  <>
                    <Button
                      variant="secondary"
                      icon={<Icon icon={RotateCcw} />}
                      disabled={busy}
                      onClick={() => setEdits({})}
                    >
                      {t('targets.discard')}
                    </Button>
                    <Button
                      variant="primary"
                      icon={<Icon icon={Save} />}
                      busy={busy}
                      disabled={issues.size > 0}
                      onClick={() => void save()}
                    >
                      {t('targets.save')}
                    </Button>
                  </>
                ) : null}
              </span>
            </div>
          ) : null}
          {asking ? (
            <Confirm
              question={t(asking === 'lock' ? 'targets.lock_question' : 'targets.copy_question', {
                count: selected.size,
                month: formatMonth(previousMonth(period), { locale }),
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
                  {selectable ? (
                    <th scope="col" className="w-0">
                      <input
                        type="checkbox"
                        aria-label={t('targets.select_all')}
                        checked={allSelected}
                        onChange={(event) =>
                          setSelected(new Set(event.target.checked ? everyone : []))
                        }
                      />
                    </th>
                  ) : null}
                  <th scope="col">{t('targets.person')}</th>
                  {metrics.map((metric) => {
                    const unit = unitOf(metric);
                    return (
                      <th key={metric.key} scope="col" className="r">
                        {metric.name[locale].other}
                        {unit ? <span className="sub">{unit.text}</span> : null}
                      </th>
                    );
                  })}
                  <th scope="col">{t('targets.status')}</th>
                </tr>
              </thead>
              <tbody>
                {data.sets.map((set) => (
                  <tr key={set.user.id} className={selected.has(set.user.id) ? 'sel' : undefined}>
                    {selectable ? (
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
                      <span className="whitespace-nowrap">{set.user.name}</span>
                      <span className="ks-muted caption block font-normal">{set.user.code}</span>
                    </th>
                    {metrics.map((metric) => (
                      <td key={metric.key} className="r">
                        {cell(set, metric)}
                      </td>
                    ))}
                    <td>
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusBadge variant={STATUS_BADGE[set.status]}>
                          {t(`targets.status_${set.status}`)}
                        </StatusBadge>
                        {set.status === 'locked' && set.lockedBy ? (
                          <span className="ks-muted caption">
                            {t('targets.locked_by', { name: set.lockedBy.name })}
                          </span>
                        ) : null}
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
                    {selectable ? <td /> : null}
                    <th scope="row">{t('targets.team_total')}</th>
                    {metrics.map((metric) => (
                      <td key={metric.key} className="r">
                        {shown(metric, data.totals[metric.key])}
                      </td>
                    ))}
                    <td />
                  </tr>
                ) : null}
                <tr>
                  {selectable ? <td /> : null}
                  <th scope="row">{t('targets.own')}</th>
                  {metrics.map((metric) => (
                    <td key={metric.key} className="r">
                      {shown(metric, data.own.values[metric.key])}
                    </td>
                  ))}
                  <td>
                    <StatusBadge variant={STATUS_BADGE[data.own.status]}>
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
