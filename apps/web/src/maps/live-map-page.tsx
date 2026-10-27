import { formatNumber } from '@thelamp/i18n';
import { initialsOf, isStale, type LivePerson } from '@thelamp/shared';
import {
  Button,
  EmptyState,
  Icon,
  ListItem,
  PageHeader,
  SelectField,
  StatusBadge,
} from '@thelamp/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { Route as RouteIcon, Users } from 'lucide-react';
import { useState } from 'react';
import { useAccountTypes } from '../accounts/data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { rowLink } from '../row-link';
import { useAccountPins, useLive } from './data';
import { AccountsLegend, Dot, type DotLook, MapLegend, MapView, seriesOf, useMapsKey } from './map';
import { type MapViewKey, MapViews } from './views';

/** Minutes since a moment, rounded down. */
const minutesSince = (at: string, now: number) =>
  Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));

/** A person's state on the live map: moving or at a visit, off the plan, or no signal. */
type State = 'inside' | 'outside' | 'stale';

function stateOf(person: LivePerson, now: number): State {
  if (person.paused || !person.seenAt || isStale(person.seenAt, new Date(now))) return 'stale';
  return person.offPlan ? 'outside' : 'inside';
}

const LOOK: Record<State, DotLook> = {
  inside: { tone: 'inside' },
  outside: { tone: 'outside' },
  stale: { tone: 'stale' },
};

/** What a person is doing, as their row says it: where, and how the day goes against the plan. */
function useStatusLine() {
  const { t, locale } = useLanguage();
  const n = (value: number) => formatNumber(value, { locale });
  return (person: LivePerson, state: State): string => {
    const doing = person.paused
      ? t('live.paused')
      : !person.position
        ? t('live.no_position')
        : state === 'stale'
          ? person.place
            ? t('live.last_seen_at', { place: person.place })
            : t('live.stale')
          : person.offPlan
            ? t('live.off_plan')
            : person.visit
              ? t('live.visiting', { name: person.visit.account.name })
              : person.place
                ? t('live.moving_after', { place: person.place })
                : t('live.moving');
    const visits =
      person.visits.planned !== null
        ? t('live.visits_of', { done: n(person.visits.done), planned: n(person.visits.planned) })
        : person.visits.done > 0
          ? t('live.visits_done', { count: person.visits.done, n: n(person.visits.done) })
          : null;
    return visits ? `${doing} · ${visits}` : doing;
  };
}

/**
 * The live map (M17, decision D104): everyone on duty in scope where they were last seen, each a
 * dot with their initials in one of three states, with a key over the map; beside it the people,
 * counted by state, each saying where they are and how their day goes. The accounts layer, a
 * person's day replayed and the density grid are the map's other views. It reads again every 30
 * seconds (decision D60).
 */
export function LiveMapPage({ view: initial = 'live' }: { view?: 'live' | 'pins' | 'replay' }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const navigate = useNavigate();
  const mapsKey = useMapsKey();
  const statusLine = useStatusLine();
  const [view, setView] = useState<'live' | 'pins' | 'replay'>(initial);
  const [replayOf, setReplayOf] = useState('');
  const live = useLive();
  const types = useAccountTypes() ?? [];
  const pins = useAccountPins(view === 'pins');
  // Staleness is measured at the moment the server answered.
  const now = live.data ? Date.parse(live.data.readAt) : 0;
  const people = live.data?.people ?? [];
  const placed = people.filter((person) => person.position);
  const accounts = view === 'pins' ? (pins.data?.items ?? []) : [];
  const typeName = (key: string) => types.find((type) => type.key === key)?.name[locale].one ?? key;
  const shown = types
    .filter((type) => accounts.some((pin) => pin.type === type.key))
    .map((type) => ({
      key: type.key,
      name: type.name[locale].other,
      series: seriesOf(types, type.key),
    }));
  const states = people.map((person) => stateOf(person, now));
  const count = (state: State) => states.filter((entry) => entry === state).length;
  const n = (value: number) => formatNumber(value, { locale });
  const legend = (
    <MapLegend
      entries={[
        { look: LOOK.inside, label: t('live.legend_moving') },
        { look: LOOK.outside, label: t('live.legend_off_plan') },
        { look: LOOK.stale, label: t('live.legend_stale') },
      ]}
    />
  );

  const choose = (next: MapViewKey) => {
    if (next === 'density') void navigate({ to: '/density' });
    else setView(next);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('live.title')}
        meta={t('live.meta')}
        actions={<MapViews value={view} onChange={choose} />}
      />
      {live.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(live.error, t)}
        </p>
      ) : null}
      {view === 'replay' ? (
        <form
          className="ks-card flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (replayOf) {
              void navigate({ to: '/people/$userId/replay', params: { userId: replayOf } });
            }
          }}
        >
          <SelectField
            label={t('live.replay_person')}
            className="min-w-[14rem]"
            none={t('live.replay_choose')}
            value={replayOf}
            options={people.map((person) => ({ value: person.user.id, label: person.user.name }))}
            onChange={(event) => setReplayOf(event.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={!replayOf}
            icon={<Icon icon={RouteIcon} />}
          >
            {t('live.replay_open')}
          </Button>
        </form>
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="ks-map-frame">
            <MapView
              label={t('live.map_label')}
              height={640}
              frame={`${placed.length}:${accounts.length}`}
              fit={[
                ...placed.map((person) => person.position!),
                ...accounts.map((pin) => pin.location),
              ]}
            >
              {accounts.map((pin) => (
                <Dot
                  key={pin.id}
                  at={pin.location}
                  series={seriesOf(types, pin.type)}
                  hollow={!pin.visited}
                  title={`${pin.name} · ${typeName(pin.type)} · ${pin.visited ? t('live.visited') : t('live.not_visited')}`}
                />
              ))}
              {placed.map((person) => (
                <Dot
                  key={person.user.id}
                  at={person.position!}
                  {...LOOK[stateOf(person, now)]}
                  tag={initialsOf(person.user.name)}
                  title={`${person.user.name} · ${statusLine(person, stateOf(person, now))}`}
                />
              ))}
            </MapView>
            {mapsKey ? legend : null}
          </div>
          {mapsKey ? null : legend}
          {shown.length > 0 ? <AccountsLegend types={shown} /> : null}
        </div>
        <section aria-labelledby="live-people" className="ks-card flex flex-col gap-0 p-0">
          <div className="flex flex-col gap-2 border-b border-[var(--border)] p-4">
            <h2 id="live-people" className="heading-md">
              {t('live.on_duty', { count: people.length })}
            </h2>
            {people.length > 0 ? (
              <p className="flex flex-wrap gap-1">
                <StatusBadge variant="success">
                  {t('live.count_moving', { count: count('inside'), n: n(count('inside')) })}
                </StatusBadge>
                <StatusBadge variant="waiting">
                  {t('live.count_off_plan', { count: count('outside'), n: n(count('outside')) })}
                </StatusBadge>
                <StatusBadge variant="neutral">
                  {t('live.count_stale', { count: count('stale'), n: n(count('stale')) })}
                </StatusBadge>
              </p>
            ) : null}
          </div>
          {!live.data ? (
            <p className="ks-muted p-4">{t('common.loading')}</p>
          ) : people.length === 0 ? (
            <EmptyState icon={<Icon icon={Users} />} title={t('live.empty_title')}>
              {t('live.empty_body')}
            </EmptyState>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              <ul aria-label={t('live.list')} className="divide-y divide-[var(--border)]">
                {people.map((person, index) => {
                  const state = states[index]!;
                  const seen = person.seenAt ? minutesSince(person.seenAt, now) : null;
                  return (
                    <ListItem
                      key={person.user.id}
                      lead={<span aria-hidden="true" className={`ks-map-dot ${state}`} />}
                      title={person.user.name}
                      meta={statusLine(person, state)}
                      trailing={
                        <span className="caption ks-subtle whitespace-nowrap">
                          {seen === null
                            ? '—'
                            : seen === 0
                              ? t('live.now')
                              : seen < 60
                                ? t('live.minutes', { count: seen, n: n(seen) })
                                : t('live.hours', {
                                    count: Math.floor(seen / 60),
                                    n: n(Math.floor(seen / 60)),
                                  })}
                        </span>
                      }
                      {...(access.can('trail.view')
                        ? { as: rowLink(`/people/${person.user.id}/replay`) }
                        : {})}
                    />
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
