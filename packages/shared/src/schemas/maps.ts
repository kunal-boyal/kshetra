import { z } from 'zod';
import { GeoPoint } from '../geo';
import { Key } from './config';
import { GEOFENCE_RESULTS } from './field';
import { Period } from './planning';

/** Maps (M17, spec 11.2, decision D60): the live map, account pins, day replay and density. */

const Person = z.object({ id: z.uuid(), code: z.string(), name: z.string() });
const AccountRef = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

/** One person on duty, as the live map shows them. */
export const LivePerson = z.object({
  user: Person,
  shiftId: z.uuid(),
  onDutySince: z.iso.datetime(),
  paused: z.boolean(),
  /** Null until the shift's first point. */
  position: GeoPoint.nullable(),
  accuracy: z.number().nullable(),
  battery: z.int().nullable(),
  /** When the position was taken; stale after 15 minutes (M17). */
  seenAt: z.iso.datetime().nullable(),
  visit: z.object({ account: AccountRef, checkInAt: z.iso.datetime() }).nullable(),
  /** Visits checked in today, against today's plan items; `planned` null without a plan today. */
  visits: z.object({ done: z.int(), planned: z.int().nullable() }),
  /** The account of the visit they are at, else of their last visit today. */
  place: z.string().nullable(),
  /** Farther than ten geofence radii from every located account in today's plan. */
  offPlan: z.boolean(),
});

export const LiveResult = z
  .object({ people: z.array(LivePerson), readAt: z.iso.datetime() })
  .meta({ id: 'LiveResult' });

export const AccountPinsQuery = z.strictObject({
  /** The month whose visits colour the pins; the current month by default. */
  period: Period.optional(),
});

export const AccountPin = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  type: Key,
  location: GeoPoint,
  visited: z.boolean(),
});

export const AccountPinsResult = z
  .object({
    period: Period,
    items: z.array(AccountPin),
    /** True when there were more located accounts than the map takes. */
    truncated: z.boolean(),
  })
  .meta({ id: 'AccountPinsResult' });

export const TrailQuery = z.strictObject({ userId: z.uuid(), date: z.iso.date() });

export const TrailShift = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  /** `points` while the raw fixes are kept (with times), `trail` once only the compacted line is. */
  source: z.enum(['points', 'trail']),
  points: z.array(GeoPoint.extend({ at: z.iso.datetime().nullable() })),
  distanceM: z.int().min(0),
  gaps: z.array(z.object({ from: z.iso.datetime(), to: z.iso.datetime() })),
  pauses: z.array(z.object({ from: z.iso.datetime(), to: z.iso.datetime().nullable() })),
});

export const TrailVisit = z.object({
  id: z.uuid(),
  account: AccountRef,
  location: GeoPoint,
  checkInAt: z.iso.datetime(),
  checkOutAt: z.iso.datetime().nullable(),
  geofence: z.enum(GEOFENCE_RESULTS),
  distanceM: z.int().nullable(),
});

export const TrailResult = z
  .object({
    user: Person,
    date: z.iso.date(),
    shifts: z.array(TrailShift),
    visits: z.array(TrailVisit),
  })
  .meta({ id: 'TrailResult' });

export const DensityQuery = z.strictObject({ period: Period });

export const DensityResult = z
  .object({
    period: Period,
    /** The grid's cell, in degrees. */
    cell: z.number(),
    cells: z.array(z.object({ lat: z.number(), lng: z.number(), visits: z.int().min(1) })),
    visits: z.int().min(0),
  })
  .meta({ id: 'DensityResult' });

export type LivePerson = z.output<typeof LivePerson>;
export type LiveResult = z.output<typeof LiveResult>;
export type AccountPinsQuery = z.output<typeof AccountPinsQuery>;
export type AccountPin = z.output<typeof AccountPin>;
export type AccountPinsResult = z.output<typeof AccountPinsResult>;
export type TrailQuery = z.output<typeof TrailQuery>;
export type TrailShift = z.output<typeof TrailShift>;
export type TrailVisit = z.output<typeof TrailVisit>;
export type TrailResult = z.output<typeof TrailResult>;
export type DensityQuery = z.output<typeof DensityQuery>;
export type DensityResult = z.output<typeof DensityResult>;
