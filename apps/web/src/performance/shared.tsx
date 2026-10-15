import { formatMoney, formatNumber } from '@kshetra/i18n';
import {
  Leaderboard,
  type MetricFigures,
  type PerformanceMetric,
  PersonPerformance,
  TeamPerformance,
} from '@kshetra/shared';
import { Icon, KpiTile, StatusBadge } from '@kshetra/ui-web';
import { useQuery } from '@tanstack/react-query';
import { ChartNoAxesColumn } from 'lucide-react';
import { useApp } from '../context';
import { useLanguage } from '../i18n';
import { read, useAccess } from '../people/data';

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
}: {
  metric: PerformanceMetric;
  figures: MetricFigures | undefined;
  /** Whether the target set is still a draft (BR-06): the tile says so. */
  draft: boolean;
}) {
  const { t, locale } = useLanguage();
  const figure = useFigure();
  const percent = usePercent();
  const actual = figures?.actual ?? null;
  const target = figures?.target ?? null;
  const pending = figures?.pending && Number(figures.pending) > 0 ? figures.pending : null;
  const share = (value: string | null) =>
    value !== null && target !== null && Number(target) > 0 ? Number(value) / Number(target) : 0;
  return (
    <KpiTile
      label={metric.name[locale].other}
      icon={<Icon icon={ChartNoAxesColumn} />}
      hue="sky"
      value={metric.available ? figure(metric, actual) : t('performance.not_yet')}
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
            {t('performance.of_target', { target: figure(metric, target) })}
          </>
        )
      }
      pending={pending ? t('performance.pending', { value: figure(metric, pending) }) : undefined}
      badge={
        draft && target !== null ? (
          <StatusBadge variant="pending">{t('performance.draft_target')}</StatusBadge>
        ) : undefined
      }
    />
  );
}
