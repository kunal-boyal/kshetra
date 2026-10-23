import {
  daysBefore,
  LOCATION_PARTITION_KEEP_DAYS,
  newId,
  SETTING_DEFAULTS,
  todayIn,
} from '@kshetra/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { parquetReadObjects } from 'hyparquet';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { locationPoints } from '../src/db/schema/field';
import { FieldUpkeep } from '../src/modules/field/field.upkeep';
import { LocationArchive } from '../src/modules/field/location-archive';
import { MediaService } from '../src/modules/media/media.service';
import { pointSql } from '../src/platform/geo';
import { startOfLocalDate } from '../src/platform/local-day';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** The raw location archive and location retention (BR-41, spec 10.3, decision D69). */

const urls = inject('databaseUrls');
let app: NestFastifyApplication;
let world: World;

beforeAll(async () => {
  app = await startApp(testConfig());
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

const H = 3_600_000;
const DAY = 24 * H;
const HERE = { lat: 28.6315, lng: 77.2167 };
const FIX = { location: HERE, accuracy: 15, mocked: false };
const ZONE = SETTING_DEFAULTS.timezone;

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const admin = new pg.Client({ connectionString: urls.admin });
  await admin.connect();
  try {
    return (await admin.query<T>(text, values)).rows;
  } finally {
    await admin.end();
  }
}

/** A field user who worked a shift today, through the API, so the shift has a trail. */
async function worker(name: string) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  const user = await world.user(tenantId, { phone, designation: 'executive' });
  const token = (await world.signIn(phone, newDevice())).accessToken;
  const post = (url: string, payload: object) =>
    app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      payload,
    });
  const start = Date.now() - 2 * H;
  const shiftId = newId();
  await post('/v1/shifts', {
    ...FIX,
    id: shiftId,
    startedAt: new Date(start).toISOString(),
    consentVersion: '2026-10',
  });
  const walk = [10, 20].map((minutes) => ({
    id: newId(),
    shiftId,
    capturedAt: new Date(start + minutes * 60_000).toISOString(),
    location: HERE,
    accuracy: 12,
    mocked: false,
    source: 'background',
  }));
  expect((await post('/v1/locations/batch', { points: walk })).json().accepted).toHaveLength(2);
  await post(`/v1/shifts/${shiftId}/end`, { ...FIX, endedAt: new Date(start + H).toISOString() });
  return { tenantId, userId: user.id, shiftId };
}

/** Points of a day long gone, at noon on the tenant's clock, a minute apart, walking north. */
async function oldPoints(
  t: { tenantId: string; userId: string; shiftId: string },
  date: string,
  count: number,
) {
  const noon = startOfLocalDate(date, ZONE).getTime() + 12 * H;
  const rows = Array.from({ length: count }, (_, index) => ({
    tenantId: t.tenantId,
    id: newId(),
    shiftId: t.shiftId,
    userId: t.userId,
    capturedAt: new Date(noon + index * 60_000),
    point: pointSql({ lat: HERE.lat + index * 0.001, lng: HERE.lng }),
    accuracy: 10 + index,
    speed: index === 0 ? null : 1.5,
    source: 'background' as const,
    battery: index === 0 ? null : 80,
  }));
  await world.database.forTenant(t.tenantId, (tx) => tx.insert(locationPoints).values(rows));
  return rows.map((row) => row.id);
}

const pointsOn = async (tenantId: string, date: string) =>
  (
    await sql<{ n: number }>(
      'select count(*)::int as n from cell.location_points where tenant_id = $1 and captured_at >= $2 and captured_at < $3',
      [tenantId, startOfLocalDate(date, ZONE), startOfLocalDate(daysBefore(date, -1), ZONE)],
    )
  )[0]!.n;

const archives = (tenantId: string) =>
  sql<{ date: string; part: number; media_id: string; points: number; purged: boolean }>(
    `select to_char(date, 'YYYY-MM-DD') as date, part, media_id, points, purged_at is not null as purged
       from cell.location_archives where tenant_id = $1 order by date, part`,
    [tenantId],
  );

describe('the raw location archive (BR-41, decision D69)', () => {
  it('archives settled days as Parquet, purges them after the raw retention, and runs again safely', async () => {
    const t = await worker('Archive Co');
    const today = todayIn(ZONE);
    const longAgo = daysBefore(today, 40);
    const lastWeek = daysBefore(today, 10);
    const recent = daysBefore(today, 3);
    const ids = await oldPoints(t, longAgo, 3);
    await oldPoints(t, lastWeek, 2);
    await oldPoints(t, recent, 1);

    const archive = app.get(LocationArchive);
    expect(await archive.run(t.tenantId, today)).toEqual({
      archived: 2,
      purged: 3,
      trails: 0,
      expired: 0,
    });
    // Days past the longest sync window are archived; the one 3 days ago, and today, wait.
    const kept = await archives(t.tenantId);
    expect(kept).toEqual([
      { date: longAgo, part: 0, media_id: expect.any(String), points: 3, purged: true },
      { date: lastWeek, part: 0, media_id: expect.any(String), points: 2, purged: false },
    ]);
    expect(await pointsOn(t.tenantId, longAgo)).toBe(0);
    expect(await pointsOn(t.tenantId, lastWeek)).toBe(2);
    expect(await pointsOn(t.tenantId, recent)).toBe(1);

    // The file holds the day's points in time order, with every column.
    const file = await world.database.forTenant(t.tenantId, (tx) =>
      app.get(MediaService).read(tx, t.tenantId, kept[0]!.media_id),
    );
    expect(file.contentType).toBe('application/vnd.apache.parquet');
    const bytes = file.bytes;
    const rows = await parquetReadObjects({
      file: new Uint8Array(bytes).buffer,
    });
    expect(rows.map((row) => row.id)).toEqual(ids);
    expect(rows[0]).toMatchObject({
      shift_id: t.shiftId,
      user_id: t.userId,
      latitude: HERE.lat,
      longitude: HERE.lng,
      accuracy_m: 10,
      speed_mps: null,
      source: 'background',
      battery: null,
    });
    expect(rows[2]).toMatchObject({ latitude: HERE.lat + 0.002, speed_mps: 1.5, battery: 80 });
    expect((rows[0]!.captured_at as Date).getTime()).toBe(
      startOfLocalDate(longAgo, ZONE).getTime() + 12 * H,
    );

    // A second run the same night changes nothing.
    expect(await archive.run(t.tenantId, today)).toEqual({
      archived: 0,
      purged: 0,
      trails: 0,
      expired: 0,
    });
    expect(await archives(t.tenantId)).toHaveLength(2);

    // A year on, everything has been archived and purged, and the trail and the files have gone.
    const later = await archive.run(t.tenantId, daysBefore(today, -400));
    // The day 3 days ago, and today's shift (which may cross midnight).
    expect(later.archived).toBeGreaterThanOrEqual(2);
    expect(later).toMatchObject({ purged: 5, trails: 1, expired: 2 + later.archived });
    expect(
      (
        await sql<{ n: number }>(
          'select count(*)::int as n from cell.location_points where tenant_id = $1',
          [t.tenantId],
        )
      )[0]!.n,
    ).toBe(0);
    expect(await sql('select 1 from cell.shift_trails where tenant_id = $1', [t.tenantId])).toEqual(
      [],
    );
    expect(
      await sql<{ status: string }>(
        `select distinct status from cell.media where tenant_id = $1 and kind = 'location_archive'`,
        [t.tenantId],
      ),
    ).toEqual([{ status: 'deleted' }]);
    const logged = await sql<{ action: string; target_type: string }>(
      `select action, target_type from cell.audit_log where tenant_id = $1
          and action in ('locations.archived', 'retention.applied') order by 1, 2`,
      [t.tenantId],
    );
    expect(new Set(logged.map((row) => `${row.action} ${row.target_type}`))).toEqual(
      new Set([
        'locations.archived location_archive',
        'retention.applied location_archive',
        'retention.applied location_points',
        'retention.applied shift_trails',
      ]),
    );
  });

  it("leaves other tenants' points alone", async () => {
    const a = await worker('Archive A');
    const b = await worker('Archive B');
    const date = daysBefore(todayIn(ZONE), 50);
    await oldPoints(a, date, 2);
    await oldPoints(b, date, 3);
    await app.get(LocationArchive).run(a.tenantId, todayIn(ZONE));
    expect(await pointsOn(a.tenantId, date)).toBe(0);
    expect(await pointsOn(b.tenantId, date)).toBe(3);
    expect(await archives(b.tenantId)).toEqual([]);
  });
});

describe('location partitions (decision D69)', () => {
  const partitions = async () =>
    (
      await sql<{ name: string }>(
        `select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
          where i.inhparent = 'cell.location_points'::regclass order by 1`,
      )
    ).map((row) => row.name);
  const named = (daysAgo: number) =>
    `location_points_p${new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10).replaceAll('-', '')}`;

  it('drops old partitions once every tenant has emptied them, and keeps any still holding points', async () => {
    const t = await worker('Partition Co');
    // The database was made today, with a week of partitions behind it; one of them has a point.
    expect(await partitions()).toEqual(expect.arrayContaining([named(6), named(5)]));
    const noon = new Date(Date.now() - 5 * DAY);
    noon.setUTCHours(12, 0, 0, 0);
    await world.database.forTenant(t.tenantId, (tx) =>
      tx.insert(locationPoints).values({
        tenantId: t.tenantId,
        id: newId(),
        shiftId: t.shiftId,
        userId: t.userId,
        capturedAt: noon,
        point: pointSql(HERE),
        accuracy: 10,
        source: 'background',
      }),
    );
    // Run as though the keeping time had passed for everything older than 4 days.
    const now = new Date(Date.now() + (LOCATION_PARTITION_KEEP_DAYS - 4) * DAY);
    expect(await app.get(FieldUpkeep).partitions(now)).toBeGreaterThan(0);
    const left = await partitions();
    expect(left).not.toContain(named(6));
    expect(left).toContain(named(5));
    expect(left).toContain(named(0));
    expect(left).toContain('location_points_default');
  });

  it('runs only as the cell, never for anyone else', async () => {
    const directory = new pg.Client({ connectionString: urls.directoryApp });
    await directory.connect();
    try {
      await expect(
        directory.query('select cell.drop_empty_location_partitions(now())'),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await directory.end();
    }
  });
});
