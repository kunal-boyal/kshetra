import { formatNumber } from '@thelamp/i18n';
import { positionAt, todayIn, type TrailShift } from '@thelamp/shared';
import { EmptyState, Icon, StatusBadge, TextField } from '@thelamp/ui-web';
import { Route as RouteIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { PageHeader, Section, useDates } from '../people/shared';
import { useTrail } from './data';
import { Dot, MapView, Route } from './map';

const GEOFENCE_TONE = { inside: 'success', outside: 'danger', unknown: 'neutral' } as const;

/**
 * A person's day replayed (M17): each shift's route from fixes of 100 m or better, a time slider
 * that moves a marker along it while the fixes are kept, the visits coloured by geofence result,
 * and the distance, gaps and pauses.
 */
export function ReplayPage({ userId }: { userId: string }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const [date, setDate] = useState(() => todayIn(access.timezone));
  const trail = useTrail(userId, date);
  const data = trail.data;
  const timed = useMemo(
    () =>
      (data?.shifts ?? []).flatMap((shift) =>
        shift.points.flatMap((point) =>
          point.at ? [{ lat: point.lat, lng: point.lng, at: Date.parse(point.at) }] : [],
        ),
      ),
    [data],
  );
  const first = timed[0]?.at ?? 0;
  const last = timed[timed.length - 1]?.at ?? 0;
  const [moment, setMoment] = useState<number | null>(null);
  const at = moment ?? last;
  const here = timed.length ? positionAt(timed, at) : null;
  const everyPoint = (data?.shifts ?? []).flatMap((shift) => shift.points);
  const distance = (data?.shifts ?? []).reduce((sum, shift) => sum + shift.distanceM, 0);
  const km = (metres: number) =>
    formatNumber(metres / 1000, { locale }, { maximumFractionDigits: 1 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={data ? t('replay.title_for', { name: data.user.name }) : t('replay.title')}
        back={{ to: '/live-map', label: t('live.title') }}
      />
      <TextField
        label={t('replay.date')}
        type="date"
        className="max-w-xs"
        value={date}
        onChange={(event) => {
          if (!event.target.value) return;
          setDate(event.target.value);
          setMoment(null);
        }}
      />
      {trail.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(trail.error, t)}
        </p>
      ) : !data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : data.shifts.length === 0 ? (
        <EmptyState icon={<Icon icon={RouteIcon} />} title={t('replay.empty_title')}>
          {t('replay.empty_body')}
        </EmptyState>
      ) : (
        <>
          <p>
            {t('replay.summary', {
              count: data.shifts.length,
              distance: km(distance),
              visits: data.visits.length,
            })}
          </p>
          <MapView label={t('replay.map_label')} fit={everyPoint}>
            {data.shifts.map((shift) => (
              <Route key={shift.id} path={shift.points} />
            ))}
            {data.visits.map((visit) => (
              <Dot
                key={visit.id}
                at={visit.location}
                tone={GEOFENCE_TONE[visit.geofence]}
                title={`${visit.account.name} · ${t(`review.geofence_${visit.geofence}`)}`}
              />
            ))}
            {here ? <Dot at={here} title={t('replay.here')} tone="pending" /> : null}
          </MapView>
          {timed.length > 1 ? (
            <div className="ks-field">
              <label className="ks-label" htmlFor="replay-time">
                {t('replay.time', { time: dates.dateTime(new Date(at).toISOString()) })}
              </label>
              <input
                id="replay-time"
                type="range"
                min={first}
                max={last}
                step={60_000}
                value={at}
                onChange={(event) => setMoment(Number(event.target.value))}
              />
            </div>
          ) : null}
          {data.shifts.some((shift) => shift.source === 'trail') ? (
            <p className="ks-muted">{t('replay.trail_only')}</p>
          ) : null}
          {data.shifts.map((shift: TrailShift) => (
            <Section
              key={shift.id}
              title={t('replay.shift', {
                from: dates.dateTime(shift.startedAt),
                to: shift.endedAt ? dates.dateTime(shift.endedAt) : t('replay.still_on'),
              })}
            >
              <p>{t('replay.distance', { distance: km(shift.distanceM) })}</p>
              {shift.gaps.length > 0 ? (
                <ul className="ks-muted">
                  {shift.gaps.map((gap) => (
                    <li key={gap.from}>
                      {t('replay.gap', {
                        from: dates.dateTime(gap.from),
                        to: dates.dateTime(gap.to),
                      })}
                    </li>
                  ))}
                </ul>
              ) : null}
              {shift.pauses.length > 0 ? (
                <ul className="ks-muted">
                  {shift.pauses.map((pause) => (
                    <li key={pause.from}>
                      {t('replay.pause', {
                        from: dates.dateTime(pause.from),
                        to: pause.to ? dates.dateTime(pause.to) : t('replay.still_on'),
                      })}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Section>
          ))}
          <Section title={t('replay.visits')}>
            {data.visits.length === 0 ? (
              <p className="ks-muted">{t('replay.no_visits')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.visits.map((visit) => (
                  <li key={visit.id} className="flex flex-wrap items-center gap-2">
                    <span>{visit.account.name}</span>
                    <span className="ks-muted text-sm">{dates.dateTime(visit.checkInAt)}</span>
                    <StatusBadge
                      variant={
                        visit.geofence === 'inside'
                          ? 'success'
                          : visit.geofence === 'outside'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {t(`review.geofence_${visit.geofence}`)}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
