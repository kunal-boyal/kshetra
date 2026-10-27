import { distanceMeters, type GeoPoint } from './geo';

/**
 * Maps (M17, decision D60): what the live map, the day replay and the density grid compute
 * alike on the server and in the apps.
 */

/** A position older than this, while on duty, is flagged on the live map (M17). */
export const LIVE_STALE_MINUTES = 15;

/** The live map reads again this often (decision D60). */
export const LIVE_REFRESH_MS = 30_000;

/** The density grid's cell, in degrees: about 1.1 km north to south (M17). */
export const DENSITY_CELL_DEG = 0.01;

/** Whether a position seen at `seenAt` is stale at `now`. */
export function isStale(seenAt: Date | string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(seenAt).getTime() > LIVE_STALE_MINUTES * 60_000;
}

/** How many geofence radii from every planned account counts as off the plan (decision D104). */
export const OFF_PLAN_RADII = 10;

/**
 * Whether someone at `at` is off today's plan: farther than `OFF_PLAN_RADII` geofence radii from
 * every planned account with a location. Without a position or a located planned account, never.
 */
export function offPlan(
  at: GeoPoint | null,
  planned: readonly GeoPoint[],
  radiusM: number,
): boolean {
  if (!at || planned.length === 0) return false;
  return planned.every((place) => distanceMeters(at, place) > radiusM * OFF_PLAN_RADII);
}

/** Points from Google's encoded polyline format, at five decimal places (spec 12.1). */
export function decodePolyline(encoded: string): GeoPoint[] {
  const points: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** The length of a path along the Earth, in metres. */
export function pathLengthMeters(points: readonly GeoPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distanceMeters(points[index - 1]!, points[index]!);
  }
  return total;
}

export interface TimedPoint extends GeoPoint {
  /** Milliseconds since the epoch. */
  at: number;
}

/**
 * Where a replayed route stood at a moment (M17): between two fixes, the point along the line in
 * proportion to the time; before the first or after the last, that end. Null without fixes.
 */
export function positionAt(points: readonly TimedPoint[], at: number): GeoPoint | null {
  if (points.length === 0) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (at <= first.at) return { lat: first.lat, lng: first.lng };
  if (at >= last.at) return { lat: last.lat, lng: last.lng };
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    if (at <= b.at) {
      const share = b.at === a.at ? 1 : (at - a.at) / (b.at - a.at);
      return { lat: a.lat + (b.lat - a.lat) * share, lng: a.lng + (b.lng - a.lng) * share };
    }
  }
  return { lat: last.lat, lng: last.lng };
}
