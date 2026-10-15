import { spacing } from '@kshetra/design-tokens';
import { formatDateTime } from '@kshetra/i18n';
import type { PerformanceMetric } from '@kshetra/shared';
import { Button, KpiTile, ListGroup, Notice, StatusBadge, Text } from '@kshetra/ui-mobile';
import { router } from 'expo-router';
import { ChartNoAxesColumn, RotateCw, Trophy } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useMonth, useMyMonth, useTileParts } from '../performance';

/** Pairs of tiles, two-up on a phone (components/KpiTile). */
function pairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2));
  return rows;
}

/**
 * My month on Home (spec 8.1, M9): a tile per metric with a target first, the approved actual
 * against it and pending work apart, then the score and rank, and the way to the leaderboard. It
 * shows the last figures the phone read, and when, without signal.
 */
export function MyMonth() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const period = useMonth();
  const month = useMyMonth(period);
  const parts = useTileParts();
  const permissions = new Set<string>(config.data?.bundle.access.permissions ?? []);
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  const kept = month.data;

  if (!kept) {
    return (
      <ListGroup title={t('performance.my_month')}>
        {month.isError ? (
          <View style={styles.stack}>
            <Text tone="danger" role="alert">
              {errorMessage(month.error, t)}
            </Text>
            <Button
              variant="secondary"
              icon={RotateCw}
              label={t('common.retry')}
              onPress={() => void month.refetch()}
            />
          </View>
        ) : (
          <Text tone="muted">{t('common.loading')}</Text>
        )}
      </ListGroup>
    );
  }

  const data = kept.data;
  // Targeted metrics lead; what isn't counted yet goes last.
  const rank = (metric: PerformanceMetric) =>
    !metric.available ? 2 : data.figures[metric.key]?.target != null ? 0 : 1;
  const metrics = [...data.metrics].sort((a, b) => rank(a) - rank(b));
  return (
    <ListGroup title={t('performance.my_month')}>
      <View style={styles.stack}>
        <View style={styles.summary}>
          <Text variant="headingMd">
            {data.score === null
              ? t('performance.not_ranked')
              : t('performance.score_is', { score: data.score })}
          </Text>
          {data.rank !== null && data.group ? (
            <Text tone="muted">
              {t('performance.rank_in', {
                rank: data.rank,
                size: data.group.size,
                group: data.group.name[locale].other,
              })}
            </Text>
          ) : null}
        </View>
        <Notice>{data.locked ? t('copy.pending_work') : t('performance.not_locked')}</Notice>
        {pairs(metrics).map((row) => (
          <View key={row.map((metric) => metric.key).join()} style={styles.pair}>
            {row.map((metric) => {
              const tile = parts(metric, data.figures[metric.key]);
              return (
                <KpiTile
                  key={metric.key}
                  label={metric.name[locale].other}
                  icon={ChartNoAxesColumn}
                  hue="sky"
                  value={tile.value}
                  progress={tile.progress}
                  foot={tile.foot}
                  pending={tile.pending}
                  badge={
                    !data.locked && data.figures[metric.key]?.target != null ? (
                      <StatusBadge variant="pending" label={t('performance.draft_target')} />
                    ) : undefined
                  }
                />
              );
            })}
            {row.length === 1 ? <View style={styles.filler} /> : null}
          </View>
        ))}
        <Text variant="bodySm" tone="muted">
          {t('performance.read_at', { time: formatDateTime(kept.readAt, { locale, timeZone }) })}
        </Text>
        {permissions.has('leaderboard.view') ? (
          <Button
            variant="tonal"
            icon={Trophy}
            label={t('leaderboard.title')}
            onPress={() => router.push('/leaderboard')}
          />
        ) : null}
      </View>
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
  summary: { gap: spacing.space1 },
  pair: { flexDirection: 'row', gap: spacing.space3 },
  filler: { flex: 1 },
});
