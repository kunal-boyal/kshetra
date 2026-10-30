import { periodKind } from '@thelamp/shared';
import { PageHeader, PeriodStepper, Tabs, tabPanelProps } from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { LeaderboardPanel } from './leaderboard-page';
import { useTargetPeriods } from './shared';
import { TeamPanel } from './team-page';

/** The Performance page's tabs: the ranking, and a manager's own team. */
export type PerformanceView = 'leaderboard' | 'team';

/** The tab in the page's address, so `/leaderboard` and links can open the one they mean. */
export function performanceSearch(search: Record<string, unknown>): { view?: PerformanceView } {
  return search.view === 'leaderboard' || search.view === 'team' ? { view: search.view } : {};
}

/**
 * Performance (M9, decision D104): one page for the period's standing (a month, or a quarter or
 * year, D108), as the prototype has it.
 * The Leaderboard tab ranks a designation across the organisation for everyone who may see it;
 * the My team tab shows a manager their own people against every metric, with totals. A field
 * person sees the ranking, and their own month a click away.
 */
export function PerformancePage({ view: asked }: { view?: PerformanceView }) {
  const { t } = useLanguage();
  const access = useAccess();
  const periods = useTargetPeriods();
  const [picked, setPeriod] = useState<string>();
  const period = picked ?? periods.current;
  const views: PerformanceView[] = [
    ...(access.can('leaderboard.view') ? (['leaderboard'] as const) : []),
    ...(access.can('performance.view_team') ? (['team'] as const) : []),
  ];
  const [chosen, setChosen] = useState<PerformanceView | undefined>(asked);
  const view = chosen && views.includes(chosen) ? chosen : views[0];
  const month = periods.format(period);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('performance.team_title_for', { month })}
        meta={view === 'team' ? t('performance.team_intro') : t('leaderboard.meta')}
        actions={
          <>
            <Link
              to="/performance/$userId"
              params={{ userId: 'me' }}
              className="ks-btn secondary sm"
            >
              {t(`performance.my_${periodKind(periods.current)}`)}
            </Link>
            {access.can('report.view') ? (
              <Link to="/reports" className="ks-btn ghost sm">
                {t('leaderboard.export')}
              </Link>
            ) : null}
          </>
        }
        toolbar={
          <>
            {views.length > 1 && view ? (
              <Tabs
                label={t('performance.views')}
                idPrefix="performance"
                value={view}
                onChange={setChosen}
                choices={views.map((entry) => ({
                  value: entry,
                  label: t(`performance.tab_${entry}`),
                }))}
              />
            ) : null}
            <PeriodStepper
              value={period}
              onChange={setPeriod}
              format={periods.format}
              {...periods.stepper(period)}
            />
          </>
        }
      />
      {view ? (
        <div {...(views.length > 1 ? tabPanelProps('performance', view) : {})}>
          {view === 'team' ? <TeamPanel period={period} /> : <LeaderboardPanel period={period} />}
        </div>
      ) : (
        <p className="ks-muted">{t('common.loading')}</p>
      )}
    </div>
  );
}
