import type { FormView } from '@thelamp/forms';
import { formatNumber } from '@thelamp/i18n';
import { REVIEW_NOTE_MIN, ReviewItem, type ReviewPhoto } from '@thelamp/shared';
import { Button, DescriptionList, Icon, StatusBadge, TextAreaField } from '@thelamp/ui-web';
import { Link } from '@tanstack/react-router';
import { Check, MapPin, X } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { Area, Dot, MapView } from '../maps/map';
import { useAccess, write } from '../people/data';
import { fieldErrors, useDates } from '../people/shared';
import { usePhotoLink, useRefreshReview } from './data';

type Translate = ReturnType<typeof useLanguage>['t'];

export const STATUS_VARIANT = {
  pending: 'pending',
  approved: 'success',
  rejected: 'danger',
} as const;

/** Flags that point at evidence that can't be trusted, drawn in danger rather than amber. */
export const DANGER_FLAGS = new Set<string>(['duplicate_photo']);

/** A filled-in value as a reviewer reads it. */
function valueText(value: unknown, t: Translate): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return t(value ? 'review.yes' : 'review.no');
  if (Array.isArray(value)) return t('review.items', { count: value.length });
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The chosen submission (M7, decision D104): what it is, who, where and when; its flags and the
 * geofence; what was filled in; its photos with a small map of the check-in; the decisions so far;
 * and the note and buttons to decide. A rejection, and any change of mind, needs the note.
 */
export function ReviewDetail({
  item,
  form,
  onDecided,
}: {
  item: ReviewItem;
  form: FormView | undefined;
  /** Called once a decision is saved, so the queue can move on. */
  onDecided: () => void;
}) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const refresh = useRefreshReview();
  const [mapped, setMapped] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const [failure, setFailure] = useState<unknown>();
  const name = item.form.name[locale].one;
  const metres = (value: number) => formatNumber(value, { locale });
  const firstName = item.user.name.split(' ')[0] ?? item.user.name;
  const labels = new Map(
    (form?.fields ?? []).flatMap((field) =>
      'label' in field && field.label ? [[field.key, field.label[locale]] as const] : [],
    ),
  );
  const noteError = fieldErrors(failure).note;

  async function decide(decision: 'approved' | 'rejected') {
    setBusy(decision);
    setFailure(undefined);
    try {
      await write(client, 'POST', `/v1/submissions/${item.id}/review`, ReviewItem, {
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNote('');
      onDecided();
      await refresh();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(null);
    }
  }

  // A pending submission takes either decision; a decided one, only the other.
  const choices: ('rejected' | 'approved')[] =
    item.status === 'pending'
      ? ['rejected', 'approved']
      : [item.status === 'approved' ? 'rejected' : 'approved'];

  return (
    <div id="review-detail" className="flex scroll-mt-40 flex-col gap-4">
      <div className="ks-spread items-start gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="heading-lg">{name}</h2>
          <p className="ks-meta">
            <Link to="/people/$userId" params={{ userId: item.user.id }}>
              {item.user.name}
            </Link>
            {item.account ? (
              <>
                {' · '}
                <Link to="/accounts/$accountId" params={{ accountId: item.account.id }}>
                  {item.account.name}
                </Link>
              </>
            ) : null}
            {' · '}
            {dates.dateTime(item.capturedAt)}
          </p>
        </div>
        <StatusBadge variant={STATUS_VARIANT[item.status]}>
          {t(`review.status_${item.status}`)}
        </StatusBadge>
      </div>

      <div className="flex flex-wrap gap-2">
        {item.flags.map((flag) => (
          <span key={flag} className={DANGER_FLAGS.has(flag) ? 'ks-flag danger' : 'ks-flag'}>
            {t(`submissions.flag_${flag}`)}
          </span>
        ))}
        {item.integrityWarning ? (
          <span className="ks-flag danger">{t('review.integrity')}</span>
        ) : null}
        {item.geofence === 'inside' || item.geofence === 'outside' ? (
          <span className={`ks-pill ${item.geofence}`}>
            {t(item.geofence === 'inside' ? 'submissions.inside' : 'submissions.outside', {
              distance: metres(item.distanceM ?? 0),
            })}
          </span>
        ) : item.geofence === 'unknown' ? (
          <StatusBadge variant="neutral">{t('submissions.unknown')}</StatusBadge>
        ) : null}
        {item.autoApproved ? (
          <StatusBadge variant="info">{t('review.auto_approved')}</StatusBadge>
        ) : null}
      </div>
      {item.autoApproveAt ? (
        <p className="ks-meta">
          {t('review.auto_at', { when: dates.dateTime(item.autoApproveAt) })}
        </p>
      ) : null}
      <p className="ks-meta">
        {t('review.captured', {
          when: dates.dateTime(item.capturedAt),
          received: dates.dateTime(item.receivedAt),
        })}
      </p>

      <section aria-label={t('review.values')}>
        <DescriptionList
          items={Object.entries(item.values).map(
            ([key, value]) => [labels.get(key) ?? key, valueText(value, t)] as const,
          )}
        />
      </section>

      {item.photoDetails.length > 0 || item.geofenceAt ? (
        <section className="flex flex-col gap-2" aria-label={t('review.photos')}>
          <ul className="ks-photos flex-wrap">
            {item.photoDetails.map((photo, index) => (
              <li key={photo.id}>
                <Photo photo={photo} number={index + 1} />
              </li>
            ))}
            {item.geofenceAt ? (
              <li>
                <MiniMap item={item} />
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          icon={<Icon icon={MapPin} />}
          aria-expanded={mapped}
          onClick={() => setMapped((open) => !open)}
        >
          {mapped ? t('review.hide_map') : t('review.show_map')}
        </Button>
        {mapped ? (
          <MapView label={t('review.map_label')} fit={[item.location]} height={240}>
            <Area at={item.location} radius={Math.max(5, item.accuracy)} />
            <Dot at={item.location} title={t('review.map_point')} />
          </MapView>
        ) : null}
      </div>

      {item.reviews.length > 0 ? (
        <section className="flex flex-col gap-1" aria-label={t('review.history')}>
          <h3 className="label-md">{t('review.history')}</h3>
          <ol className="flex flex-col gap-1">
            {item.reviews.map((review) => (
              <li key={review.at}>
                {review.reviewer
                  ? t('review.decided_by', {
                      decision: t(`review.status_${review.decision}`),
                      name: review.reviewer.name,
                      when: dates.dateTime(review.at),
                    })
                  : t('review.decided_auto', {
                      decision: t(`review.status_${review.decision}`),
                      when: dates.dateTime(review.at),
                    })}
                {review.note ? <span className="ks-muted"> · {review.note}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <TextAreaField
        label={t('review.note_to', { name: firstName })}
        help={t('review.note_help', { min: REVIEW_NOTE_MIN })}
        rows={2}
        value={note}
        {...(noteError ? { error: noteError } : {})}
        onChange={(event) => setNote(event.target.value)}
      />
      {failure && !noteError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="ks-actions">
        {choices.map((decision) => (
          <Button
            key={decision}
            variant={decision === 'rejected' ? 'danger' : 'primary'}
            busy={busy === decision}
            disabled={busy !== null && busy !== decision}
            icon={<Icon icon={decision === 'rejected' ? X : Check} />}
            onClick={() => void decide(decision)}
          >
            {item.status === 'pending'
              ? t(decision === 'rejected' ? 'review.reject' : 'review.approve')
              : t(decision === 'rejected' ? 'review.reject_instead' : 'review.approve_instead')}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** A photo's 112 × 84 thumbnail, with when it was taken and how far away, in tags over it. */
function Photo({ photo, number }: { photo: ReviewPhoto; number: number }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const link = usePhotoLink(photo.id);
  const alt = [
    t('review.photo_alt', { number }),
    photo.source ? t(`review.photo_source_${photo.source}`) : null,
    photo.capturedAt ? dates.dateTime(photo.capturedAt) : null,
    photo.distanceM !== null
      ? t('review.photo_far', { distance: formatNumber(photo.distanceM, { locale }) })
      : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <figure className="flex w-28 flex-col gap-1">
      {link.data ? (
        <img src={link.data.url} alt={alt} className="ks-photo wide object-cover" loading="lazy" />
      ) : (
        <div className="ks-photo wide" role="img" aria-label={alt} />
      )}
      <figcaption className="ks-help" aria-hidden="true">
        {[
          photo.capturedAt ? dates.time(photo.capturedAt) : null,
          photo.distanceM !== null
            ? t('review.photo_metres', { distance: formatNumber(photo.distanceM, { locale }) })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </figcaption>
      {photo.duplicate ? (
        <span className="ks-flag danger self-start">{t('review.photo_repeat')}</span>
      ) : null}
    </figure>
  );
}

/** Metres east and north of `from` to `to`, near enough for a small map. */
function offset(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const metresPerDegree = 111_320;
  return {
    east: (to.lng - from.lng) * metresPerDegree * Math.cos((from.lat * Math.PI) / 180),
    north: (to.lat - from.lat) * metresPerDegree,
  };
}

/**
 * The account's geofence ring and where the form was filled, drawn to scale on a 112 × 84 tile in
 * the map tokens: inside in the success colour, outside in the warning one.
 */
function MiniMap({ item }: { item: ReviewItem }) {
  const { t, locale } = useLanguage();
  if (!item.geofenceAt) return null;
  const { location, radiusM } = item.geofenceAt;
  const { east, north } = offset(location, item.location);
  const distance = Math.round(Math.hypot(east, north));
  // The ring and the dot both fit, with room around them.
  const scale = 34 / Math.max(radiusM * 1.2, distance * 1.15, 1);
  const centre = { x: 56, y: 42 };
  const dot = { x: centre.x + east * scale, y: centre.y - north * scale };
  const inside = distance <= radiusM;
  return (
    <div
      className="ks-mapbox"
      role="img"
      aria-label={t('review.minimap', {
        distance: formatNumber(distance, { locale }),
        radius: formatNumber(radiusM, { locale }),
      })}
    >
      <svg viewBox="0 0 112 84" width="112" height="84" aria-hidden="true">
        <circle
          cx={centre.x}
          cy={centre.y}
          r={radiusM * scale}
          style={{
            fill: 'var(--map-geofence)',
            fillOpacity: 0.12,
            stroke: 'var(--map-geofence)',
            strokeDasharray: '4 4',
          }}
        />
        <circle
          cx={dot.x}
          cy={dot.y}
          r={6}
          style={{
            fill: inside ? 'var(--map-inside)' : 'var(--map-outside)',
            stroke: 'var(--surface)',
            strokeWidth: 2,
          }}
        />
      </svg>
    </div>
  );
}
