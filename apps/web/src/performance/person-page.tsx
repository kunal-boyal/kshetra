import { formatDate, formatNumber } from '@thelamp/i18n';
import { Avatar, Card, Notice, PeriodStepper } from '@thelamp/ui-web';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { PageHeader, Section } from '../people/shared';
import { SubmissionsSection } from '../submissions/submissions-section';
import { MetricTile, Movement, useFigure, usePersonPerformance, useTargetPeriods } from './shared';

/**
 * A person's period (M9; a month, or a quarter or year, D108): a tile per metric with the approved actual against the target and
 * pending work apart, the score and rank in the person's group, the daily trend, and the forms
 * behind the figures. `me` is the viewer's own.
 */
export function PersonPerformancePage({ userId }: { userId: string }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const periods = useTargetPeriods();
  const [picked, setPeriod] = useState<string>();
  const period = picked ?? periods.current;
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
        {...(data ? { lead: <Avatar name={data.user.name} id={data.user.id} size="lg" /> } : {})}
        meta={
          data
            ? [data.group?.name[locale].one, data.territory?.name].filter(Boolean).join(' · ') ||
              undefined
            : undefined
        }
        toolbar={
          <PeriodStepper
            value={period}
            onChange={setPeriod}
            format={periods.format}
            {...periods.stepper(period)}
          />
        }
        {...(access.can('performance.view_team')
          ? { back: { to: '/performance', label: t('performance.team_title') } }
          : {})}
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
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-4">
              <div>
                <dt className="ks-meta">{t('performance.score')}</dt>
                <dd className="metric-xl">
                  {data.score === null
                    ? t('performance.not_ranked')
                    : formatNumber(data.score, { locale })}
                </dd>
              </div>
              <div>
                <dt className="ks-meta">{t('performance.rank')}</dt>
                <dd className="metric-xl">
                  {data.rank && data.group
                    ? t('performance.rank_of', {
                        rank: formatNumber(data.rank, { locale }),
                        size: formatNumber(data.group.size, { locale }),
                      })
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="ks-meta">{t('leaderboard.since_last_week')}</dt>
                <dd className="pt-2">
                  <Movement rank={data.rank} previous={data.previousRank} />
                </dd>
              </div>
              <div>
                <dt className="ks-meta">{t('performance.group')}</dt>
                <dd className="pt-2">
                  {data.group ? data.group.name[locale].other : t('performance.no_group')}
                </dd>
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
              <div className="relative w-full overflow-x-auto">
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
