import { formatDate, formatMonth } from '@thelamp/i18n';
import {
  CopyTargetsResult,
  TargetListResult,
  TargetSetResult,
  UNLOCK_REASON_MIN,
} from '@thelamp/shared';
import { Button, Icon, StatusBadge, TextAreaField } from '@thelamp/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, LockOpen } from 'lucide-react';
import { useId, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { useFigure, usePersonPerformance } from '../performance/shared';

/** The month after a `YYYY-MM` month. */
export function nextMonth(period: string): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * A person's targets for the month beside their plan (decision D104): each metric's target and how
 * far they have come, whether the set is locked and by whom, with an unlock (with its reason) and
 * a copy to the next month for those allowed.
 */
export function PlanTargets({ userId, period }: { userId: string; period: string }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const figure = useFigure();
  const headingId = useId();
  const targets = useQuery({
    queryKey: ['targets', period],
    queryFn: () => read(client, `/v1/targets?period=${period}`, TargetListResult),
  });
  const performance = usePersonPerformance(period, userId);
  const [unlocking, setUnlocking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [failure, setFailure] = useState<unknown>();

  const data = targets.data;
  const set =
    data?.sets.find((entry) => entry.user.id === userId) ??
    (data?.own.user.id === userId ? data.own : undefined);
  const metrics = (data?.metrics ?? []).filter((metric) => metric.targetable);
  const month = formatMonth(period, { locale });
  const following = nextMonth(period);

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

  const unlock = () =>
    act(async () => {
      await write(client, 'POST', '/v1/targets/unlock', TargetSetResult, {
        userId,
        period,
        reason,
      });
      setUnlocking(false);
      setReason('');
      return t('targets.unlocked', { name: set?.user.name ?? '' });
    });

  const copy = () =>
    act(async () => {
      const result = await write(client, 'POST', '/v1/targets/copy', CopyTargetsResult, {
        period: following,
        from: period,
        userIds: [userId],
      });
      return t('targets.copied', { count: result?.copied.length ?? 0 });
    });

  return (
    <section className="ks-card flex min-w-0 flex-col gap-4" aria-labelledby={headingId}>
      <div className="ks-spread items-start gap-3">
        <h2 id={headingId} className="heading-md">
          {t('plan.targets_title', { month })}
        </h2>
        {set && set.status === 'locked' ? (
          <StatusBadge variant="success">
            {set.lockedAt
              ? t('plan.targets_locked_on', {
                  date: formatDate(set.lockedAt.slice(0, 10), { locale }),
                })
              : t('targets.status_locked')}
          </StatusBadge>
        ) : set ? (
          <StatusBadge variant="neutral">{t(`targets.status_${set.status}`)}</StatusBadge>
        ) : null}
      </div>
      {targets.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(targets.error, t)}
        </p>
      ) : !data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : !set || set.status === 'none' || metrics.length === 0 ? (
        <p className="ks-muted">{t('plan.targets_none')}</p>
      ) : (
        <div
          className="relative overflow-x-auto"
          role="region"
          aria-label={t('plan.targets_caption', { month })}
          tabIndex={0}
        >
          <table className="ks-table">
            <caption className="sr-only">{t('plan.targets_caption', { month })}</caption>
            <thead>
              <tr>
                <th scope="col">{t('plan.targets_metric')}</th>
                <th scope="col" className="r">
                  {t('plan.targets_target')}
                </th>
                <th scope="col" className="r">
                  {t('plan.targets_so_far')}
                </th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={metric.key}>
                  <th scope="row">{metric.name[locale].other}</th>
                  <td className="r">{figure(metric, set.values[metric.key] ?? null)}</td>
                  <td className="r">
                    {figure(metric, performance.data?.figures[metric.key]?.actual ?? null)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {set?.status === 'locked' ? (
        <p className="ks-meta">
          {set.lockedBy
            ? t('plan.targets_note_by', { name: set.lockedBy.name })
            : t('plan.targets_note')}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {unlocking ? (
        <div className="flex flex-col gap-3">
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
              size="sm"
              icon={<Icon icon={LockOpen} />}
              busy={busy}
              disabled={reason.trim().length < UNLOCK_REASON_MIN}
              onClick={() => void unlock()}
            >
              {t('targets.unlock')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setUnlocking(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : set && (access.can('target.unlock') || access.can('target.edit')) ? (
        <div className="flex flex-wrap gap-2">
          {set.status === 'locked' && access.can('target.unlock') ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon icon={LockOpen} />}
              onClick={() => setUnlocking(true)}
            >
              {t('targets.unlock')}
            </Button>
          ) : null}
          {set.status !== 'none' && access.can('target.edit') ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Icon icon={Copy} />}
              busy={busy}
              onClick={() => void copy()}
            >
              {t('plan.copy_to', { month: formatMonth(following, { locale }) })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
