import { formatNumber } from '@thelamp/i18n';
import { EmptyState, FilterChips, Icon } from '@thelamp/ui-web';
import { Users } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import {
  Movement,
  PersonCell,
  RankCell,
  useFigure,
  usePercent,
  useTeamPerformance,
} from './shared';

/**
 * The team's month (M9, decision D104), the Performance page's My team tab: each person in scope
 * by rank, with their territory, each metric's attainment (its actual on hover), their score and
 * move since last week, and the team's totals from summed parts (BR-04). Chips narrow it to a
 * designation; a name opens the person's month.
 */
export function TeamPanel({ period }: { period: string }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const [designation, setDesignation] = useState<string | null>(null);
  const team = useTeamPerformance(period);
  const figure = useFigure();
  const percent = usePercent();
  const metrics = team.data?.metrics.filter((metric) => metric.available) ?? [];
  const everyone = team.data?.rows ?? [];
  // Ranked people first by rank; the rest after, as the team lists them.
  const order = (rank: number | null) => rank ?? Number.MAX_SAFE_INTEGER;
  const rows = everyone
    .filter((row) => designation === null || row.designation === designation)
    .sort((a, b) => order(a.rank) - order(b.rank));
  const designations = [...new Set(everyone.map((row) => row.designation))].map((key) => ({
    value: key,
    label: access.designations.find((entry) => entry.key === key)?.name[locale].other ?? key,
    count: everyone.filter((row) => row.designation === key).length,
  }));

  return (
    <div className="flex flex-col gap-4">
      {designations.length > 1 ? (
        <FilterChips
          label={t('performance.designation')}
          choices={designations}
          value={designation}
          onChange={setDesignation}
          formatCount={(n) => formatNumber(n, { locale })}
          clearable
        />
      ) : null}
      {team.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(team.error, t)}
        </p>
      ) : !team.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : everyone.length === 0 ? (
        <EmptyState icon={<Icon icon={Users} />} title={t('performance.team_empty_title')}>
          {t('performance.team_empty_body')}
        </EmptyState>
      ) : (
        <div className="relative w-full overflow-x-auto">
          <table className="ks-table">
            <caption className="sr-only">{t('performance.team_caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('performance.rank')}</th>
                <th scope="col">{t('performance.person')}</th>
                <th scope="col">{t('performance.territory')}</th>
                {metrics.map((metric) => (
                  <th key={metric.key} scope="col" className="r">
                    {metric.name[locale].other}
                  </th>
                ))}
                <th scope="col" className="r">
                  {t('performance.score')}
                </th>
                <th scope="col">{t('leaderboard.since_last_week')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user.id}>
                  <td>
                    <RankCell rank={row.rank} />
                  </td>
                  <th scope="row">
                    <PersonCell user={row.user} link />
                  </th>
                  <td>{row.territory?.name ?? '–'}</td>
                  {metrics.map((metric) => {
                    const figures = row.figures[metric.key];
                    const actual = figure(metric, figures?.actual ?? null);
                    return (
                      <td key={metric.key} className="r">
                        {figures?.attainment != null ? (
                          <span title={actual}>{percent(figures.attainment)}</span>
                        ) : (
                          actual
                        )}
                      </td>
                    );
                  })}
                  <td className="r">
                    <b>
                      {row.score === null
                        ? t('performance.not_ranked')
                        : formatNumber(row.score, { locale })}
                    </b>
                  </td>
                  <td>
                    <Movement rank={row.rank} previous={row.previousRank} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <th scope="row">{t('performance.team_total')}</th>
                <td />
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
