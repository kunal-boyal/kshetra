import { radius, size, spacing } from '@thelamp/design-tokens';
import { formatDateTime, formatNumber, formatTime } from '@thelamp/i18n';
import { type PerformanceMetric, periodKind } from '@thelamp/shared';
import {
  AppBar,
  Button,
  KpiTile,
  ListGroup,
  ListRow,
  Notice,
  ScoreRing,
  Screen,
  SeqBadge,
  StatusBadge,
  Text,
  useTheme,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ChartNoAxesColumn, RotateCw, Trophy } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useLeaderboard, useMyMonth, usePeriod, usePeriodName, useTileParts } from '../performance';

/** Pairs of tiles, two-up on a phone (components/KpiTile). */
function pairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2));
  return rows;
}

type Month = NonNullable<ReturnType<typeof useMyMonth>['data']>['data'];

/** Targeted metrics lead; what isn't counted yet goes last. */
function inOrder(data: Month): PerformanceMetric[] {
  const rank = (metric: PerformanceMetric) =>
    !metric.available ? 2 : data.figures[metric.key]?.target != null ? 0 : 1;
  return [...data.metrics].sort((a, b) => rank(a) - rank(b));
}

/** One metric against its target, pending work apart (components/KpiTile). */
function MetricTile({ metric, data }: { metric: PerformanceMetric; data: Month }) {
  const { t, locale } = useLanguage();
  const parts = useTileParts();
  const tile = parts(metric, data.figures[metric.key]);
  return (
    <KpiTile
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
}

/**
 * My month at a glance on Home (spec 8.1, M9, decision D104): the first two tiles and the rank,
 * which opens the whole month. Nothing shows until the phone has read the month once.
 */
export function MonthGlance() {
  const { t, locale } = useLanguage();
  const period = usePeriod();
  const data = useMyMonth(period).data?.data;
  if (!data) return null;
  const first = inOrder(data).slice(0, 2);
  const open = () => router.push('/month');
  return (
    <View style={styles.stack}>
      <View style={styles.spread}>
        <Text variant="headingMd" role="heading" style={styles.grow}>
          {t(`performance.my_${periodKind(period)}`)}
        </Text>
        <Pressable role="link" onPress={open} style={styles.link}>
          <Text variant="labelMd" weight={600} tone="accent">
            {data.rank !== null && data.group
              ? t('home.rank_of', {
                  rank: formatNumber(data.rank, { locale }),
                  size: formatNumber(data.group.size, { locale }),
                })
              : t('home.see_month')}
          </Text>
        </Pressable>
      </View>
      {first.length > 0 ? (
        <View style={styles.pair}>
          {first.map((metric) => (
            <MetricTile key={metric.key} metric={metric} data={data} />
          ))}
          {first.length === 1 ? <View style={styles.filler} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** How many leaderboard rows My month shows; the person's own joins them when further down. */
const BOARD_ROWS = 5;

/**
 * `/month`: the whole month (spec 8.1, M9) as the prototype's AppMonth (decision D104): the month
 * and when it was read in the bar, then My month below.
 */
export function MonthScreen() {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const period = usePeriod();
  const named = usePeriodName();
  const kept = useMyMonth(period).data;
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <AppBar
        title={named(period)}
        {...(kept
          ? {
              subtitle: t('performance.updated', {
                time: formatTime(kept.readAt, { locale, timeZone }),
              }),
            }
          : {})}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        backLabel={t('common.back')}
      />
      <MyMonth />
    </Screen>
  );
}

/** Where the rank moved since last week, or nothing without a rank then. */
function movement(
  rank: number | null,
  previous: number | null,
  t: ReturnType<typeof useLanguage>['t'],
): string | null {
  if (rank === null || previous === null) return null;
  if (rank < previous) return t('performance.moved_up', { count: previous - rank });
  if (rank > previous) return t('performance.moved_down', { count: rank - previous });
  return t('performance.moved_same');
}

/**
 * My month (spec 8.1, M9): the score as a ring on the product's Forest panel with the rank and
 * where it moved, a tile per metric with a target first, the approved actual against it and
 * pending work apart, and the person's group on the leaderboard. It shows the last figures the
 * phone read, and when, without signal.
 */
export function MyMonth() {
  const { t, locale } = useLanguage();
  const theme = useTheme();
  const config = useConfig();
  const period = usePeriod();
  const month = useMyMonth(period);
  const permissions = new Set<string>(config.data?.bundle.access.permissions ?? []);
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  const kept = month.data;
  if (!kept) {
    return month.isError ? (
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
    );
  }
  const data = kept.data;
  const metrics = inOrder(data);
  const ink = { color: theme.colors.onBrand };
  const moved = movement(data.rank, data.previousRank, t);
  return (
    <View style={styles.stack}>
      <View style={[styles.panel, { backgroundColor: theme.colors.brandForest }]}>
        <ScoreRing
          value={data.score}
          label={
            data.score === null
              ? t('performance.not_ranked')
              : t('performance.ring_label', { score: formatNumber(data.score, { locale }) })
          }
        />
        <View style={styles.grow}>
          <Text variant="labelMd" weight={600} style={[ink, styles.soft]}>
            {t('performance.my_score')}
          </Text>
          <Text variant="headingLg" style={ink}>
            {data.rank !== null && data.group
              ? t('performance.rank_hash', {
                  rank: formatNumber(data.rank, { locale }),
                  size: formatNumber(data.group.size, { locale }),
                })
              : t('performance.not_ranked')}
          </Text>
          {moved ? (
            <Text variant="bodySm" style={[ink, styles.soft]}>
              {moved}
            </Text>
          ) : null}
        </View>
      </View>
      <Notice>{data.locked ? t('copy.pending_work') : t('performance.not_locked')}</Notice>
      {pairs(metrics).map((row) => (
        <View key={row.map((metric) => metric.key).join()} style={styles.pair}>
          {row.map((metric) => (
            <MetricTile key={metric.key} metric={metric} data={data} />
          ))}
          {row.length === 1 ? <View style={styles.filler} /> : null}
        </View>
      ))}
      <Text variant="bodySm" tone="muted">
        {t('performance.read_at', { time: formatDateTime(kept.readAt, { locale, timeZone }) })}
      </Text>
      {permissions.has('leaderboard.view') ? <Board period={period} /> : null}
    </View>
  );
}

/** The person's group on the leaderboard: its first rows, theirs tinted, and the way to all. */
function Board({ period }: { period: string }) {
  const { t, locale } = useLanguage();
  const board = useLeaderboard(period).data;
  if (!board) return null;
  const group = board.groups.find((entry) => entry.key === board.group);
  const first = board.rows.slice(0, BOARD_ROWS);
  const mine = board.rows.findIndex((row) => row.you);
  const rows = mine >= BOARD_ROWS ? [...first, board.rows[mine]!] : first;
  return (
    <View style={styles.stack}>
      <ListGroup
        title={
          group
            ? t('performance.board_title', { group: group.name[locale].other })
            : t('leaderboard.title')
        }
      >
        {rows.map((row) => (
          <ListRow
            key={row.user.id}
            lead={
              row.rank === null ? (
                <View style={styles.seqSpace} />
              ) : (
                <SeqBadge n={row.rank} {...(row.you ? { tone: 'now' as const } : {})} />
              )
            }
            label={row.you ? t('performance.you_row', { name: row.user.name }) : row.user.name}
            {...(row.territory ? { detail: row.territory.name } : {})}
            trailing={
              <Text variant="headingMd" style={styles.figure}>
                {row.score === null ? '–' : formatNumber(row.score, { locale })}
              </Text>
            }
            highlight={row.you}
          />
        ))}
      </ListGroup>
      <Button
        variant="tonal"
        icon={Trophy}
        label={t('leaderboard.title')}
        onPress={() => router.push('/leaderboard')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space4,
    padding: spacing.space4,
    borderRadius: radius.radiusXl,
  },
  soft: { opacity: 0.85 },
  figure: { fontVariant: ['tabular-nums'] },
  seqSpace: { width: 28 },
  summary: { gap: spacing.space1 },
  pair: { flexDirection: 'row', gap: spacing.space3 },
  filler: { flex: 1 },
  spread: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  grow: { flex: 1 },
  link: { minHeight: size.touchMin, justifyContent: 'center' },
});
