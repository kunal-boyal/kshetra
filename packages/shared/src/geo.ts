import { z } from 'zod';

/** Places on the map (spec 10.1: `geography(Point, 4326)`), as the API and apps exchange them. */

export const GeoPoint = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .meta({ id: 'GeoPoint' });
export type GeoPoint = z.infer<typeof GeoPoint>;

/** The mean Earth radius, in metres. */
const EARTH_RADIUS_M = 6_371_008.8;

/** The distance between two points along the Earth's surface, in metres (haversine). */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A proposed location needs a fix this accurate or better (M4). */
export const PROPOSAL_ACCURACY_M = 50;
/** ...taken this soon before the person proposed it: standing at the account, not remembered. */
export const PROPOSAL_FIX_MAX_AGE_S = 120;

/**
 * Whether a fix may propose an account's location (M4): `ok`, or why not. Freshness is judged at
 * the moment the person proposed it, on the phone's clock, so a proposal made offline and sent
 * later still counts. A fix from after that moment by more than a few seconds is a wrong clock,
 * and counts as stale.
 */
export function proposalFix(
  fix: { accuracy: number; capturedAt: string },
  proposedAt: Date,
): 'ok' | 'inaccurate' | 'stale' {
  if (!(fix.accuracy >= 0) || fix.accuracy > PROPOSAL_ACCURACY_M) return 'inaccurate';
  const age = (proposedAt.getTime() - Date.parse(fix.capturedAt)) / 1000;
  if (!Number.isFinite(age) || age > PROPOSAL_FIX_MAX_AGE_S || age < -5) return 'stale';
  return 'ok';
}

/** An account's geofence radius: its own, else its type's, else the tenant's default (spec 5.5). */
export function geofenceRadius(
  account: number | null,
  type: number | undefined,
  tenantDefault: number,
): number {
  return account ?? type ?? tenantDefault;
}
