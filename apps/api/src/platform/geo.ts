import type { GeoPoint } from '@kshetra/shared';
import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

/**
 * Points in queries (spec 10.1). Columns hold `geography(Point, 4326)`; code writes them from
 * latitude and longitude and reads those back, so nothing parses the stored binary form.
 */

/** A point to store. PostGIS takes longitude first. */
export function pointSql(point: GeoPoint): SQL {
  return sql`ST_SetSRID(ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326)::geography`;
}

/** A stored point back as latitude and longitude, or null. */
export function pointOf(column: AnyColumn | SQL): SQL<GeoPoint | null> {
  return sql<GeoPoint | null>`case when ${column} is null then null else json_build_object(
    'lat', ST_Y(${column}::geometry), 'lng', ST_X(${column}::geometry)) end`;
}
