import { todayIn } from '@kshetra/shared';
import { EmptyState, Icon, Notice, SelectField, TextField } from '@kshetra/ui-web';
import { Trophy } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { PageHeader } from '../people/shared';
import { useLeaderboard } from './shared';

/**
 * A ranking group's leaderboard for the month (M9, BR-07), labelled indicative: ranked people
 * first by score, sharing a rank on equal scores, then those not ranked.
 */
export function LeaderboardPage() {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  const [group, setGroup] = useState<string>();
  const board = useLeaderboard(period, group);
  const data = board.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('leaderboard.title')} />
      <Notice>{t('copy.ranking')}</Notice>
      <div className="flex flex-wrap gap-4">
        <TextField
          label={t('plan.month')}
          type="month"
          className="max-w-xs"
          value={period}
          onChange={(event) => {
            if (event.target.value) setPeriod(event.target.value);
          }}
        />
        {data && data.groups.length > 1 ? (
          <SelectField
            label={t('leaderboard.group')}
            className="max-w-xs"
            value={data.group ?? ''}
            options={data.groups.map((entry) => ({
              value: entry.key,
              label: entry.name[locale].other,
            }))}
            onChange={(event) => setGroup(event.target.value)}
          />
        ) : null}
      </div>
      {board.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(board.error, t)}
        </p>
      ) : !data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : data.rows.length === 0 ? (
        <EmptyState icon={<Icon icon={Trophy} />} title={t('leaderboard.empty_title')}>
          {t('leaderboard.empty_body')}
        </EmptyState>
      ) : (
        <table className="ks-table">
          <caption className="sr-only">
            {t('leaderboard.caption', {
              group:
                data.groups.find((entry) => entry.key === data.group)?.name[locale].other ?? '',
            })}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="r">
                {t('performance.rank')}
              </th>
              <th scope="col">{t('performance.person')}</th>
              <th scope="col" className="r">
                {t('performance.score')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.user.id} aria-current={row.you ? 'true' : undefined}>
                <td className="r">{row.rank ?? '—'}</td>
                <th scope="row">
                  {row.user.name}{' '}
                  {row.you ? <span className="ks-muted">{t('leaderboard.you')}</span> : null}
                </th>
                <td className="r">{row.score ?? t('performance.not_ranked')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
