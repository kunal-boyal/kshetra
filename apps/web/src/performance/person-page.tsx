import { formatDate } from '@kshetra/i18n';
import { todayIn } from '@kshetra/shared';
import { Card, Notice, TextField } from '@kshetra/ui-web';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { PageHeader, Section } from '../people/shared';
import { SubmissionsSection } from '../submissions/submissions-section';
import { MetricTile, useFigure, usePersonPerformance } from './shared';

/**
 * A person's month (M9): a tile per metric with the approved actual against the target and
 * pending work apart, the score and rank in the person's group, the daily trend, and the forms
 * behind the figures. `me` is the viewer's own month.
 */
export function PersonPerformancePage({ userId }: { userId: string }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  const own = userId === 'me';
  const month = usePersonPerformance(period, own ? undefined : userId);
  const figure = useFigure();
  const data = month.data;
  const trend = data?.metrics.filter((metric) => metric.available && metric.unit !== 'percent');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          own || !data
            ? t('performance.my_title')
            : t('performance.title_for', { name: data.user.name })
        }
        {...(access.can('performance.view_team')
          ? { back: { to: '/performance', label: t('performance.team_title') } }
          : {})}
      />
      <TextField
        label={t('plan.month')}
        type="month"
        className="max-w-xs"
        value={period}
        onChange={(event) => {
          if (event.target.value) setPeriod(event.target.value);
        }}
      />
      {month.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(month.error, t)}
        </p>
      ) : !data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <>
          <Card>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
              <div>
                <dt className="ks-muted">{t('performance.score')}</dt>
                <dd className="text-2xl font-semibold">
                  {data.score ?? t('performance.not_ranked')}
                </dd>
              </div>
              <div>
                <dt className="ks-muted">{t('performance.rank')}</dt>
                <dd className="text-2xl font-semibold">
                  {data.rank && data.group
                    ? t('performance.rank_of', { rank: data.rank, size: data.group.size })
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="ks-muted">{t('performance.group')}</dt>
                <dd>{data.group ? data.group.name[locale].other : t('performance.no_group')}</dd>
              </div>
            </dl>
          </Card>
          <Notice>{data.locked ? t('copy.pending_work') : t('performance.not_locked')}</Notice>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.metrics.map((metric) => (
              <MetricTile
                key={metric.key}
                metric={metric}
                figures={data.figures[metric.key]}
                draft={!data.locked}
              />
            ))}
          </div>
          <Section title={t('performance.trend')}>
            {data.days.length === 0 || !trend?.length ? (
              <p className="ks-muted">{t('performance.trend_empty')}</p>
            ) : (
              <div className="w-full overflow-x-auto">
                <table className="ks-table">
                  <caption className="sr-only">{t('performance.trend_caption')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('performance.date')}</th>
                      {trend.map((metric) => (
                        <th key={metric.key} scope="col" className="r">
                          {metric.name[locale].other}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((day) => (
                      <tr key={day.date}>
                        <th scope="row">{formatDate(day.date, { locale })}</th>
                        {trend.map((metric) => (
                          <td key={metric.key} className="r">
                            {figure(metric, day.values[metric.key] ?? '0')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          {access.can('user.view') || access.can('submission.review') ? (
            <SubmissionsSection userId={data.user.id} />
          ) : null}
        </>
      )}
    </div>
  );
}
