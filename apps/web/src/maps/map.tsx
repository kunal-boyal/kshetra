import type { GeoPoint } from '@kshetra/shared';
import { Icon, Notice } from '@kshetra/ui-web';
import {
  AdvancedMarker,
  APIProvider,
  Circle,
  Map as GoogleMap,
  Polyline,
  useMap,
} from '@vis.gl/react-google-maps';
import { MapPinOff } from 'lucide-react';
import { type ReactNode, useEffect, useMemo } from 'react';
import { useLanguage } from '../i18n';

/**
 * Maps on the web (M17, decision D60), on the Maps JavaScript API through Google's React library.
 * The key comes from `VITE_GOOGLE_MAPS_API_KEY`; without one, as in tests, a map shows a notice
 * and the lists beside it still work.
 */

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '';
// Advanced markers need a map ID; Google's demo ID serves development (decision D60).
const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID ?? 'DEMO_MAP_ID';

/** Whether maps can draw: a key is configured. */
export const mapsEnabled = KEY.length > 0;

/** A design token's colour, as Google's drawing options need a plain value. */
export function token(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The middle of some points, or a default when there are none. */
export function centreOf(points: readonly GeoPoint[], fallback: GeoPoint = { lat: 22.5, lng: 79 }) {
  if (points.length === 0) return fallback;
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };
}

/** A zoom that fits points spanning `degrees`, roughly. */
export function zoomFor(points: readonly GeoPoint[]): number {
  if (points.length <= 1) return points.length === 1 ? 15 : 5;
  const span = Math.max(
    Math.max(...points.map((p) => p.lat)) - Math.min(...points.map((p) => p.lat)),
    Math.max(...points.map((p) => p.lng)) - Math.min(...points.map((p) => p.lng)),
  );
  return Math.max(4, Math.min(17, Math.floor(Math.log2(360 / Math.max(span, 0.0005))) - 1));
}

/** Frames the points again whenever `frame` changes, leaving the person's own panning alone. */
function Frame({ fit, frame }: { fit: readonly GeoPoint[]; frame: string }) {
  const map = useMap();
  useEffect(() => {
    if (!map || fit.length === 0) return;
    if (fit.length === 1) {
      map.setCenter(fit[0]!);
      map.setZoom(15);
      return;
    }
    const lats = fit.map((point) => point.lat);
    const lngs = fit.map((point) => point.lng);
    map.fitBounds(
      {
        north: Math.max(...lats),
        south: Math.min(...lats),
        east: Math.max(...lngs),
        west: Math.min(...lngs),
      },
      48,
    );
    // Only a new frame moves the map; points moving on a refresh don't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, frame]);
  return null;
}

/**
 * A map region with a name for assistive technology. It frames `fit`, again whenever `frame`
 * changes (by default, whenever the points do); the content is markers, lines and circles from
 * this file.
 */
export function MapView({
  label,
  fit,
  frame,
  height = 420,
  children,
}: {
  label: string;
  fit: readonly GeoPoint[];
  /** What the framing follows, for maps whose points move while someone looks. */
  frame?: string;
  height?: number;
  children?: ReactNode;
}) {
  const { t } = useLanguage();
  const centre = useMemo(() => centreOf(fit), [fit]);
  const zoom = useMemo(() => zoomFor(fit), [fit]);
  if (!mapsEnabled) {
    return (
      <div
        role="img"
        aria-label={label}
        className="flex items-center justify-center rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-sunken)] p-6"
        style={{ minHeight: Math.min(height, 160) }}
      >
        <Notice icon={<Icon icon={MapPinOff} />}>{t('maps.no_key')}</Notice>
      </div>
    );
  }
  return (
    <section aria-label={label} className="overflow-hidden rounded-[var(--radius-lg)]">
      <APIProvider apiKey={KEY}>
        <GoogleMap
          mapId={MAP_ID}
          defaultCenter={centre}
          defaultZoom={zoom}
          gestureHandling="cooperative"
          style={{ width: '100%', height }}
          reuseMaps
        >
          <Frame
            fit={fit}
            frame={frame ?? fit.map((point) => `${point.lat},${point.lng}`).join(';')}
          />
          {children}
        </GoogleMap>
      </APIProvider>
    </section>
  );
}

/** The chart series an account type takes on maps: the types in order, eight colours round. */
export function seriesOf(types: readonly { key: string }[], key: string): number {
  return (
    (Math.max(
      0,
      types.findIndex((type) => type.key === key),
    ) %
      8) +
    1
  );
}

/** A dot's look: a status tone, or an account type's series, filled or hollow. */
export interface DotLook {
  tone?: 'accent' | 'success' | 'pending' | 'danger' | 'neutral';
  series?: number;
  hollow?: boolean;
}

/** The dot's classes, for markers and for the legends beside a map. */
export function dotClass({ tone = 'accent', series, hollow }: DotLook): string {
  return ['ks-map-dot', series ? `series-${series}` : tone, hollow ? 'hollow' : '']
    .filter(Boolean)
    .join(' ');
}

/** A dot on the map in a design-system colour, with a text label for its title. */
export function Dot({
  at,
  title,
  label,
  onClick,
  ...look
}: DotLook & {
  at: GeoPoint;
  title: string;
  /** A short text inside the dot, such as a stop's number. */
  label?: string;
  onClick?: () => void;
}) {
  return (
    <AdvancedMarker position={at} title={title} {...(onClick ? { onClick } : {})}>
      <span className={[dotClass(look), 'caption', label ? 'numbered' : ''].join(' ')}>
        {label}
      </span>
    </AdvancedMarker>
  );
}

/** A route on the map, in the accent colour unless a token is named. */
export function Route({
  path,
  colour = '--accent',
}: {
  path: readonly GeoPoint[];
  colour?: string;
}) {
  return (
    <Polyline path={[...path]} strokeColor={token(colour)} strokeOpacity={0.9} strokeWeight={4} />
  );
}

/** A circle of `radius` metres, filled lightly in a token's colour. */
export function Area({
  at,
  radius,
  colour = '--accent',
  weight = 0.25,
}: {
  at: GeoPoint;
  radius: number;
  colour?: string;
  weight?: number;
}) {
  const ink = token(colour);
  return (
    <Circle
      center={at}
      radius={radius}
      strokeColor={ink}
      strokeOpacity={0.6}
      strokeWeight={1}
      fillColor={ink}
      fillOpacity={weight}
    />
  );
}

/** The key to an accounts layer: each type's colour, and what filled and hollow mean. */
export function AccountsLegend({
  types,
}: {
  types: readonly { key: string; name: string; series: number }[];
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-2 text-sm" role="group" aria-label={t('maps.legend')}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {types.map((type) => (
          <li key={type.key} className="flex items-center gap-2">
            <span aria-hidden="true" className={dotClass({ series: type.series })} />
            {type.name}
          </li>
        ))}
      </ul>
      <p className="ks-muted flex items-center gap-2">
        <span aria-hidden="true" className={dotClass({ series: types[0]?.series ?? 1 })} />
        {t('maps.visited')}
        <span
          aria-hidden="true"
          className={dotClass({ series: types[0]?.series ?? 1, hollow: true })}
        />
        {t('maps.not_visited')}
      </p>
    </div>
  );
}
