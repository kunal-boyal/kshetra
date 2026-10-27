import { formatNumber } from '@thelamp/i18n';
import type { Leaderboard } from '@thelamp/shared';
import {
  type Column,
  DataTable,
  EmptyState,
  FilterChips,
  Icon,
  Notice,
  ShareBar,
} from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { Trophy } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { Movement, PersonCell, RankCell, useLeaderboard, usePercent } from './shared';

type Row = Leaderboard['rows'][number];

/**
 * A ranking group's leaderboard for a month (M9, BR-07, decision D104), the Performance page's
 * Leaderboard tab, labelled indicative: the groups as chips, how the score is made, then ranked
 * people first by score, sharing a rank on equal scores, each with their territory, every scored
 * metric's attainment and their move since last week; then those not ranked.
 */
export function LeaderboardPanel({ period }: { period: string }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const [group, setGroup] = useState<string>();
  const board = useLeaderboard(period, group);
  const percent = usePercent();
  const data = board.data;
  const scored = data?.metrics.filter((metric) => metric.weight !== null) ?? [];
  const groupName =
    data?.groups.find((entry) => entry.key === data.group)?.name[locale].other ?? '';

  const columns: Column<Row>[] = [
    {
      key: 'rank',
      header: t('performance.rank'),
      render: (row) => <RankCell rank={row.rank} />,
    },
    {
      key: 'person',
      header: t('performance.person'),
      render: (row) => (
        <PersonCell
          user={row.user}
          you={row.you}
          link={row.you || access.can('performance.view_team')}
        />
      ),
    },
    {
      key: 'territory',
      header: t('performance.territory'),
      render: (row) => row.territory?.name ?? '–',
    },
    ...scored.map((metric): Column<Row> => ({
      key: metric.key,
      header: metric.name[locale].other,
      align: 'end',
      render: (row) => {
        const attainment = row.figures[metric.key]?.attainment;
        return attainment == null ? '–' : percent(attainment);
      },
    })),
    {
      key: 'score',
      header: t('performance.score'),
      align: 'end',
      render: (row) => (
        <b>
          {row.score === null ? t('performance.not_ranked') : formatNumber(row.score, { locale })}
        </b>
      ),
    },
    {
      key: 'move',
      header: t('leaderboard.since_last_week'),
      render: (row) => <Movement rank={row.rank} previous={row.previousRank} />,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {data && data.groups.length > 1 ? (
        <FilterChips
          label={t('leaderboard.group')}
          choices={data.groups.map((entry) => ({
            value: entry.key,
            label: entry.name[locale].other,
            count: entry.size,
          }))}
          value={data.group}
          onChange={(value) => setGroup(value ?? undefined)}
          formatCount={(n) => formatNumber(n, { locale })}
        />
      ) : null}
      {board.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(board.error, t)}
        </p>
      ) : !data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <>
          {scored.length > 0 ? (
            <section
              className="ks-card flex flex-wrap items-center gap-4"
              aria-labelledby="score-mix"
            >
              <h2 id="score-mix" className="heading-md">
                {t('leaderboard.score_mix')}
              </h2>
              <div className="min-w-0 flex-[1_1_22rem]">
                <ShareBar
                  label={t('leaderboard.score_mix_label', {
                    parts: scored
                      .map((metric) => `${metric.name[locale].other} ${metric.weight}`)
                      .join(', '),
                  })}
                  parts={scored.map((metric) => ({
                    label: metric.name[locale].other,
                    value: metric.weight ?? 0,
                  }))}
                />
              </div>
              {access.can('metric.manage') ? (
                <Link to="/settings/metrics" className="label-md">
                  {t('leaderboard.change_settings')}
                </Link>
              ) : null}
            </section>
          ) : null}
          <Notice>{t('copy.ranking')}</Notice>
          <DataTable
            caption={t('leaderboard.caption', { group: groupName })}
            columns={columns}
            rows={data.rows}
            rowKey={(row) => row.user.id}
            selectedKey={data.rows.find((row) => row.you)?.user.id ?? null}
            empty={
              <EmptyState icon={<Icon icon={Trophy} />} title={t('leaderboard.empty_title')}>
                {t('leaderboard.empty_body')}
              </EmptyState>
            }
          />
        </>
      )}
    </div>
  );
}
