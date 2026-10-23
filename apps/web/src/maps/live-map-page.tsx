import { formatNumber } from '@thelamp/i18n';
import { isStale, type LivePerson } from '@thelamp/shared';
import { Checkbox, EmptyState, Icon, StatusBadge } from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { Grid3x3, Route as RouteIcon, Users } from 'lucide-react';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccountTypes } from '../accounts/data';
import { useAccess } from '../people/data';
import { PageHeader, useDates } from '../people/shared';
import { useAccountPins, useLive } from './data';
import { AccountsLegend, Dot, MapView, seriesOf } from './map';

/** Minutes since a moment, rounded down. */
const minutesSince = (at: string, now: number) =>
  Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));

/** One person in the side list: last seen, flagged once stale, on duty since, and their visit. */
function PersonRow({ person, now }: { person: LivePerson; now: number }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const stale = person.seenAt ? isStale(person.seenAt, new Date(now)) : true;
  return (
    <li className="flex flex-col gap-1 border-b border-[var(--border)] py-3 last:border-b-0">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{person.user.name}</span>
        <span className="flex flex-wrap gap-1">
          {person.paused ? <StatusBadge variant="waiting">{t('live.paused')}</StatusBadge> : null}
          {stale ? <StatusBadge variant="danger">{t('live.stale')}</StatusBadge> : null}
        </span>
      </span>
      <span className="ks-muted text-sm">
        {person.seenAt
          ? t('live.seen', {
              count: minutesSince(person.seenAt, now),
              minutes: formatNumber(minutesSince(person.seenAt, now), { locale }),
            })
          : t('live.no_position')}
        {' · '}
        {t('live.on_duty_since', { time: dates.dateTime(person.onDutySince) })}
      </span>
      {person.visit ? (
        <span className="text-sm">{t('live.visiting', { name: person.visit.account.name })}</span>
      ) : null}
      {access.can('trail.view') ? (
        <Link
          to="/people/$userId/replay"
          params={{ userId: person.user.id }}
          className="ks-btn ghost sm self-start"
        >
          <Icon icon={RouteIcon} size="sm" />
          {t('live.replay')}
        </Link>
      ) : null}
    </li>
  );
}

/**
 * The live map (M17): everyone on duty in scope where they were last seen, a side list with stale
 * positions flagged after 15 minutes, and the accounts layer, visited this month or not. It reads
 * again every 30 seconds (decision D60).
 */
export function LiveMapPage() {
  const { t, locale } = useLanguage();
  const live = useLive();
  const types = useAccountTypes() ?? [];
  const [showAccounts, setShowAccounts] = useState(false);
  const pins = useAccountPins(showAccounts);
  // Staleness is measured at the moment the server answered.
  const now = live.data ? Date.parse(live.data.readAt) : 0;
  const people = live.data?.people ?? [];
  const placed = people.filter((person) => person.position);
  const accounts = showAccounts ? (pins.data?.items ?? []) : [];
  const typeName = (key: string) => types.find((type) => type.key === key)?.name[locale].one ?? key;
  const shown = types
    .filter((type) => accounts.some((pin) => pin.type === type.key))
    .map((type) => ({
      key: type.key,
      name: type.name[locale].other,
      series: seriesOf(types, type.key),
    }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('live.title')} intro={t('live.intro')}>
        <Link to="/density" className="ks-btn secondary">
          <Icon icon={Grid3x3} />
          {t('density.title')}
        </Link>
      </PageHeader>
      {live.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(live.error, t)}
        </p>
      ) : null}
      <Checkbox
        label={t('live.show_accounts')}
        checked={showAccounts}
        onChange={(event) => setShowAccounts(event.target.checked)}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(16rem,22rem)]">
        <div className="flex flex-col gap-3">
          <MapView
            label={t('live.map_label')}
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
                tone={person.seenAt && !isStale(person.seenAt, new Date(now)) ? 'accent' : 'danger'}
                title={person.user.name}
              />
            ))}
          </MapView>
          {shown.length > 0 ? <AccountsLegend types={shown} /> : null}
        </div>
        <section aria-label={t('live.list')} className="ks-card flex flex-col">
          <h2 className="heading-md">{t('live.on_duty', { count: people.length })}</h2>
          {!live.data ? (
            <p className="ks-muted">{t('common.loading')}</p>
          ) : people.length === 0 ? (
            <EmptyState icon={<Icon icon={Users} />} title={t('live.empty_title')}>
              {t('live.empty_body')}
            </EmptyState>
          ) : (
            <ul>
              {people.map((person) => (
                <PersonRow key={person.user.id} person={person} now={now} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
