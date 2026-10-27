import { formatNumber, shortFigure } from '@thelamp/i18n';
import {
  Leaderboard,
  type MetricFigures,
  type PerformanceMetric,
  PersonPerformance,
  todayIn,
} from '@thelamp/shared';
import { useQuery } from '@tanstack/react-query';
import { useApp } from './app-state';
import { useConfig, useKept } from './data';
import { useLanguage } from './i18n';

/**
 * Performance on the phone (M9, decision D57): the person's own month and their group's
 * leaderboard. My month is kept on the phone with when it was read, so Home shows the last
 * figures offline; the leaderboard is read online only.
 */

export interface Kept<T> {
  data: T;
  /** When the server answered, as an ISO instant. */
  readAt: string;
}

/** The current month on the tenant's clock. */
export function useMonth(): string {
  const config = useConfig();
  return todayIn(config.data?.bundle.settings.timezone ?? 'Asia/Kolkata').slice(0, 7);
}

/** The person's own month, kept on the phone. */
export function useMyMonth(period: string) {
  const { client } = useApp();
  return useKept<Kept<PersonPerformance>>(`performance:${period}`, async () => ({
    data: (await client.request('GET', `/v1/performance?period=${period}`, PersonPerformance))!,
    readAt: new Date().toISOString(),
  }));
}

/** A ranking group's leaderboard: the person's own group unless one is named. */
export function useLeaderboard(period: string, group?: string) {
  const { client } = useApp();
  return useQuery({
    queryKey: ['leaderboard', period, group ?? 'mine'],
    queryFn: async () =>
      (await client.request(
        'GET',
        `/v1/leaderboard?period=${period}${group ? `&group=${group}` : ''}`,
        Leaderboard,
      ))!,
  });
}

/** The tile's parts for one metric: shares of the target, the foot and pending work. */
export function useTileParts() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const currency = config.data?.bundle.settings.currency ?? 'INR';
  const short = (metric: PerformanceMetric, value: string) =>
    shortFigure(metric.unit, value, { locale, currency, t });
  return (metric: PerformanceMetric, figures: MetricFigures | undefined) => {
    const actual = figures?.actual ?? null;
    const target = figures?.target ?? null;
    const pending = figures?.pending && Number(figures.pending) > 0 ? figures.pending : null;
    const share = (value: string | null) =>
      value !== null && target !== null && Number(target) > 0 ? Number(value) / Number(target) : 0;
    return {
      value: !metric.available
        ? t('performance.not_yet')
        : actual === null
          ? '—'
          : short(metric, actual),
      progress:
        target !== null && figures?.attainment != null
          ? { done: share(actual), pending: share(pending) }
          : null,
      foot: !metric.available
        ? t('performance.not_yet_help')
        : target === null
          ? t('performance.no_target')
          : t('performance.attainment_of', {
              percent: t('performance.percent', {
                value: formatNumber(Math.round((figures?.attainment ?? 0) * 100), { locale }),
              }),
              target: short(metric, target),
            }),
      pending: pending ? t('performance.pending', { value: short(metric, pending) }) : undefined,
    };
  };
}
