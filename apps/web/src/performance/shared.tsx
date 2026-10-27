import { formatMoney, formatNumber, shortFigure } from '@thelamp/i18n';
import {
  Leaderboard,
  type MetricFigures,
  type PerformanceMetric,
  PersonPerformance,
  TeamPerformance,
} from '@thelamp/shared';
import { Avatar, Icon, KpiTile, RankBadge, type RowLink, StatusBadge } from '@thelamp/ui-web';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useApp } from '../context';
import { useLanguage } from '../i18n';
import { read, useAccess } from '../people/data';
import { metricLook } from './metric-look';

/** A person's month: the caller's own without `userId` (M9). */
export function usePersonPerformance(period: string, userId?: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['performance', period, userId ?? 'me'],
    queryFn: () =>
      read(
        client,
        `/v1/performance?period=${period}${userId ? `&userId=${userId}` : ''}`,
        PersonPerformance,
      ),
  });
}

export function useTeamPerformance(period: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['performance-team', period],
    queryFn: () => read(client, `/v1/performance/team?period=${period}`, TeamPerformance),
  });
}

export function useLeaderboard(period: string, group?: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['leaderboard', period, group ?? 'mine'],
    queryFn: () =>
      read(
        client,
        `/v1/leaderboard?period=${period}${group ? `&group=${group}` : ''}`,
        Leaderboard,
      ),
  });
}

/** Formats a metric's value by its unit, in the reader's locale and the tenant's currency. */
export function useFigure() {
  const { t, locale } = useLanguage();
  const { currency } = useAccess();
  return (metric: Pick<PerformanceMetric, 'unit'>, value: string | null): string => {
    if (value === null) return '—';
    const number = Number(value);
    switch (metric.unit) {
      case 'currency':
        return formatMoney(value as `${number}`, { locale, currency });
      case 'percent':
        return t('performance.percent', {
          value: formatNumber(number, { locale }, { maximumFractionDigits: 1 }),
        });
      case 'duration':
        return t('performance.minutes', {
          value: formatNumber(number, { locale }, { maximumFractionDigits: 0 }),
        });
      default:
        return formatNumber(number, { locale }, { maximumFractionDigits: 3 });
    }
  };
}

/** Attainment as a whole percentage, uncapped. */
export function usePercent() {
  const { t, locale } = useLanguage();
  return (attainment: number) =>
    t('performance.percent', {
      value: formatNumber(Math.round(attainment * 100), { locale }),
    });
}

/** One metric's tile: approved actual, the bar towards the target, pending apart (KpiTile). */
export function MetricTile({
  metric,
  figures,
  draft,
  as,
}: {
  metric: PerformanceMetric;
  figures: MetricFigures | undefined;
  /** Whether the target set is still a draft (BR-06): the tile says so. */
  draft: boolean;
  /** Where the tile leads, when it is a link. */
  as?: RowLink;
}) {
  const { t, locale } = useLanguage();
  const { currency } = useAccess();
  const percent = usePercent();
  // Tiles shorten to lakh and crore, as the phone's do; full figures are on the person's month.
  const short = (value: string | null) =>
    value === null ? '—' : shortFigure(metric.unit, value, { locale, currency, t });
  const actual = figures?.actual ?? null;
  const target = figures?.target ?? null;
  const pending = figures?.pending && Number(figures.pending) > 0 ? figures.pending : null;
  const look = metricLook(metric);
  const share = (value: string | null) =>
    value !== null && target !== null && Number(target) > 0 ? Number(value) / Number(target) : 0;
  return (
    <KpiTile
      label={metric.name[locale].other}
      icon={<Icon icon={look.icon} />}
      hue={look.hue}
      {...(as ? { as } : {})}
      value={metric.available ? short(actual) : t('performance.not_yet')}
      progress={
        target !== null && figures?.attainment !== null && figures?.attainment !== undefined
          ? { done: share(actual), pending: share(pending) }
          : null
      }
      foot={
        !metric.available ? (
          t('performance.not_yet_help')
        ) : target === null ? (
          t('performance.no_target')
        ) : (
          <>
            <b>{figures?.attainment == null ? '—' : percent(figures.attainment)}</b>{' '}
            {t('performance.of_target', { target: short(target) })}
          </>
        )
      }
      pending={pending ? t('performance.pending', { value: short(pending) }) : undefined}
      badge={
        draft && target !== null ? (
          <StatusBadge variant="pending">{t('performance.draft_target')}</StatusBadge>
        ) : undefined
      }
    />
  );
}

/** A place in a ranking: its badge, or a dash for someone not ranked. */
export function RankCell({ rank }: { rank: number | null }) {
  const { t, locale } = useLanguage();
  if (rank === null) {
    return (
      <span className="ks-seq" aria-label={t('performance.not_ranked')}>
        –
      </span>
    );
  }
  return (
    <RankBadge
      rank={rank}
      label={t('performance.rank_label', { rank: formatNumber(rank, { locale }) })}
    />
  );
}

/** A person in a ranking or team table: their avatar and name, opening their month. */
export function PersonCell({
  user,
  you = false,
  link,
}: {
  user: { id: string; name: string };
  you?: boolean;
  /** Whether the name opens the person's month; the viewer's own always may. */
  link: boolean;
}) {
  const { t } = useLanguage();
  const name = you ? `${user.name} ${t('leaderboard.you')}` : user.name;
  return (
    <span className="flex items-center gap-2 font-semibold whitespace-nowrap">
      <Avatar name={user.name} id={user.id} size="sm" />
      {link ? (
        <Link to="/performance/$userId" params={{ userId: you ? 'me' : user.id }}>
          {name}
        </Link>
      ) : (
        name
      )}
    </span>
  );
}

/**
 * How a rank moved since the end of last week: up in green, down in red, the same in grey, and a
 * dash when there is nothing to compare, such as early in the month or for someone not ranked.
 */
export function Movement({ rank, previous }: { rank: number | null; previous: number | null }) {
  const { t, locale } = useLanguage();
  if (rank === null || previous === null) {
    return (
      <StatusBadge variant="neutral">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{t('leaderboard.move_none')}</span>
      </StatusBadge>
    );
  }
  const change = previous - rank;
  const n = formatNumber(Math.abs(change), { locale });
  if (change === 0)
    return <StatusBadge variant="neutral">{t('leaderboard.move_same')}</StatusBadge>;
  return change > 0 ? (
    <StatusBadge variant="success">{t('leaderboard.move_up', { count: change, n })}</StatusBadge>
  ) : (
    <StatusBadge variant="danger">{t('leaderboard.move_down', { count: -change, n })}</StatusBadge>
  );
}
