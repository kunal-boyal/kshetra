import { spacing } from '@thelamp/design-tokens';
import { formatDate, formatDateTime, formatNumber } from '@thelamp/i18n';
import { todayIn } from '@thelamp/shared';
import { Button, Card, EmptyState, ListGroup, ListRow, Screen, Text } from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, ChevronLeft, ChevronRight, MapPin, RotateCw, Route } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { Line, PhoneMap, Spot, type SpotTone } from '../maps';
import { useTrail } from '../maps-data';

const GEOFENCE_TONE: Record<string, SpotTone> = {
  inside: 'success',
  outside: 'danger',
  unknown: 'neutral',
};

/** The calendar date `days` away from a `YYYY-MM-DD` date. */
function addDays(date: string, days: number): string {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
}

/**
 * A person's day for their manager (spec 8.1, M17): each shift's route, the visits coloured by
 * geofence result, the distance, and the gaps and pauses, a day at a time; read online.
 */
export function PersonDayScreen({ userId }: { userId: string }) {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const timeZone = config.data?.bundle.settings.timezone ?? 'Asia/Kolkata';
  const today = todayIn(timeZone);
  const [date, setDate] = useState(today);
  const trail = useTrail(userId, date);
  const data = trail.data;
  const when = (at: string) => formatDateTime(new Date(at), { locale, timeZone });
  const km = (metres: number) =>
    formatNumber(metres / 1000, { locale }, { maximumFractionDigits: 1 });
  const points = (data?.shifts ?? []).flatMap((shift) => shift.points);
  const distance = (data?.shifts ?? []).reduce((sum, shift) => sum + shift.distanceM, 0);

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/team'))}
      />
      <Text variant="headingXl" role="heading">
        {data ? t('replay.title_for', { name: data.user.name }) : t('replay.title')}
      </Text>
      <View style={styles.row}>
        <Button
          variant="ghost"
          icon={ChevronLeft}
          label={t('day.previous')}
          onPress={() => setDate((current) => addDays(current, -1))}
        />
        <Text variant="labelMd" style={styles.grow}>
          {formatDate(date, { locale })}
        </Text>
        <Button
          variant="ghost"
          icon={ChevronRight}
          label={t('day.next')}
          disabled={date >= today}
          onPress={() => setDate((current) => addDays(current, 1))}
        />
      </View>
      {trail.isError ? (
        <View style={styles.stack}>
          <Text tone="danger" role="alert">
            {errorMessage(trail.error, t)}
          </Text>
          <Button
            variant="secondary"
            icon={RotateCw}
            label={t('common.retry')}
            onPress={() => void trail.refetch()}
          />
        </View>
      ) : !data ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : data.shifts.length === 0 ? (
        <EmptyState icon={Route} title={t('replay.empty_title')}>
          {t('day.empty_body')}
        </EmptyState>
      ) : (
        <>
          <Text>
            {t('replay.summary', {
              count: data.shifts.length,
              distance: km(distance),
              visits: data.visits.length,
            })}
          </Text>
          {points.length > 0 ? (
            <PhoneMap label={t('replay.map_label')} fit={points} frame={date} height={320}>
              {data.shifts.map((shift) => (
                <Line key={shift.id} path={shift.points} />
              ))}
              {data.visits.map((visit) => (
                <Spot
                  key={visit.id}
                  at={visit.location}
                  tone={GEOFENCE_TONE[visit.geofence] ?? 'neutral'}
                  title={`${visit.account.name} · ${t(`review.geofence_${visit.geofence}`)}`}
                />
              ))}
            </PhoneMap>
          ) : null}
          {data.shifts.some((shift) => shift.source === 'trail') ? (
            <Text tone="muted">{t('replay.trail_only')}</Text>
          ) : null}
          {data.shifts.map((shift) => (
            <Card key={shift.id} style={styles.stack}>
              <Text variant="labelMd">
                {t('replay.shift', {
                  from: when(shift.startedAt),
                  to: shift.endedAt ? when(shift.endedAt) : t('replay.still_on'),
                })}
              </Text>
              <Text>{t('replay.distance', { distance: km(shift.distanceM) })}</Text>
              {shift.gaps.map((gap) => (
                <Text key={gap.from} tone="muted">
                  {t('replay.gap', { from: when(gap.from), to: when(gap.to) })}
                </Text>
              ))}
              {shift.pauses.map((pause) => (
                <Text key={pause.from} tone="muted">
                  {t('replay.pause', {
                    from: when(pause.from),
                    to: pause.to ? when(pause.to) : t('replay.still_on'),
                  })}
                </Text>
              ))}
            </Card>
          ))}
          <ListGroup title={t('replay.visits')}>
            {data.visits.length === 0 ? <Text tone="muted">{t('replay.no_visits')}</Text> : null}
            {data.visits.map((visit) => (
              <ListRow
                key={visit.id}
                icon={MapPin}
                tone={visit.geofence === 'outside' ? 'danger' : 'default'}
                label={visit.account.name}
                detail={`${when(visit.checkInAt)} · ${t(`review.geofence_${visit.geofence}`)}`}
              />
            ))}
          </ListGroup>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  grow: { flex: 1, textAlign: 'center' },
});
