import { todayIn } from '@thelamp/shared';
import { EmptyState, Icon, TextField } from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { PageHeader } from '../people/shared';
import { useFigure, usePercent, useTeamPerformance } from './shared';

/**
 * The team's month (M9): each person in scope against each metric, their score and rank in their
 * group, and the team's totals from summed parts (BR-04). A name opens the person's month.
 */
export function TeamPerformancePage() {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  const team = useTeamPerformance(period);
  const figure = useFigure();
  const percent = usePercent();
  const metrics = team.data?.metrics.filter((metric) => metric.available) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('performance.team_title')} intro={t('performance.team_intro')}>
        <Link to="/performance/$userId" params={{ userId: 'me' }} className="ks-btn secondary">
          {t('performance.my_month')}
        </Link>
      </PageHeader>
      <TextField
        label={t('plan.month')}
        type="month"
        className="max-w-xs"
        value={period}
        onChange={(event) => {
          if (event.target.value) setPeriod(event.target.value);
        }}
      />
      {team.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(team.error, t)}
        </p>
      ) : !team.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : team.data.rows.length === 0 ? (
        <EmptyState icon={<Icon icon={Users} />} title={t('performance.team_empty_title')}>
          {t('performance.team_empty_body')}
        </EmptyState>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="ks-table">
            <caption className="sr-only">{t('performance.team_caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('performance.person')}</th>
                {metrics.map((metric) => (
                  <th key={metric.key} scope="col" className="r">
                    {metric.name[locale].other}
                  </th>
                ))}
                <th scope="col" className="r">
                  {t('performance.score')}
                </th>
                <th scope="col" className="r">
                  {t('performance.rank')}
                </th>
              </tr>
            </thead>
            <tbody>
              {team.data.rows.map((row) => (
                <tr key={row.user.id}>
                  <th scope="row">
                    <Link to="/performance/$userId" params={{ userId: row.user.id }}>
                      {row.user.name}
                    </Link>{' '}
                    <span className="ks-muted">{row.user.code}</span>
                  </th>
                  {metrics.map((metric) => {
                    const figures = row.figures[metric.key];
                    return (
                      <td key={metric.key} className="r">
                        {figure(metric, figures?.actual ?? null)}
                        {figures?.attainment != null ? (
                          <span className="ks-muted"> · {percent(figures.attainment)}</span>
                        ) : null}
                      </td>
                    );
                  })}
                  <td className="r">{row.score ?? t('performance.not_ranked')}</td>
                  <td className="r">{row.rank ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t('performance.team_total')}</th>
                {metrics.map((metric) => {
                  const totals = team.data.totals[metric.key];
                  return (
                    <td key={metric.key} className="r">
                      {figure(metric, totals?.actual ?? null)}
                      {totals?.target != null ? (
                        <span className="ks-muted">
                          {' '}
                          {t('performance.of_target', { target: figure(metric, totals.target) })}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
