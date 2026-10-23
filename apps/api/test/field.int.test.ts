import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ShiftsService } from '../src/modules/field/shifts.service';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Shifts and location tracking (M5, spec 12.1, BR-36, BR-44, decision D47). */

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
const HERE = { lat: 28.6315, lng: 77.2167 };
const FIX = { location: HERE, accuracy: 15, mocked: false };

function as(token: string, deviceTime?: string) {
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': newId(),
        ...(deviceTime ? { 'x-device-time': deviceTime } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object) => call('POST', url, payload),
    patch: (url: string, payload: object) => call('PATCH', url, payload),
  };
}

/** A tenant with its admin on the web, and a field user on a phone. */
async function field(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { admin: newPhone(), user: newPhone() };
  const admin = await world.user(tenantId, {
    phone: phones.admin,
    designation: 'head',
    role: 'tenant_admin',
  });
  const user = await world.user(tenantId, {
    phone: phones.user,
    designation: 'executive',
    managerId: admin.id,
    joiningDate: '2026-01-01',
  });
  const device = newDevice();
  return {
    tenantId,
    admin: as((await world.signIn(phones.admin)).accessToken),
    userId: user.id,
    phone: as((await world.signIn(phones.user, device)).accessToken),
    skewed: as(
      (await world.signIn(phones.user, device)).accessToken,
      new Date(Date.now() + 20 * 60_000).toISOString(),
    ),
  };
}

const punchIn = (startedAt: number, id = newId()) => ({
  ...FIX,
  id,
  startedAt: new Date(startedAt).toISOString(),
  consentVersion: '2026-10',
});

const point = (shiftId: string, capturedAt: number, overrides: object = {}) => ({
  id: newId(),
  shiftId,
  capturedAt: new Date(capturedAt).toISOString(),
  location: HERE,
  accuracy: 12,
  mocked: false,
  source: 'background',
  ...overrides,
});

describe('punching in and out (M5)', () => {
  it('opens one shift at a time, replays the same punch-in, and refuses a bad fix', async () => {
    const t = await field('Punch Co');
    const start = Date.now() - H;
    const first = punchIn(start);
    const opened = await t.phone.post('/v1/shifts', first);
    expect(opened.statusCode).toBe(201);
    expect(opened.json()).toMatchObject({
      id: first.id,
      userId: t.userId,
      startLocation: HERE,
      consentVersion: '2026-10',
      endedAt: null,
      flags: [],
    });
    const again = await t.phone.post('/v1/shifts', first);
    expect(again.statusCode).toBe(201);
    expect(again.json().id).toBe(first.id);
    const second = await t.phone.post('/v1/shifts', punchIn(start + 1_000));
    expect(second.json().error.code).toBe('ALREADY_PUNCHED_IN');
    expect((await t.phone.get('/v1/shifts/current')).json().shift.id).toBe(first.id);

    const vague = await t.phone.post(`/v1/shifts/${first.id}/end`, {
      ...FIX,
      accuracy: 400,
      endedAt: new Date().toISOString(),
    });
    expect(vague.json().error.code).toBe('GPS_INACCURATE');
    const mocked = await t.phone.post(`/v1/shifts/${first.id}/end`, {
      ...FIX,
      mocked: true,
      endedAt: new Date().toISOString(),
    });
    expect(mocked.json().error.code).toBe('GPS_MOCKED');
    const ended = await t.phone.post(`/v1/shifts/${first.id}/end`, {
      ...FIX,
      endedAt: new Date().toISOString(),
    });
    expect(ended.json()).toMatchObject({ endReason: 'punch_out', endLocation: HERE });
    expect(ended.json().onDutySeconds).toBeGreaterThan(3_590);
    expect((await t.phone.get('/v1/shifts/current')).json().shift).toBeNull();
  });

  it('starts on the phone only, flags a skewed clock, and refuses records past the sync window', async () => {
    const t = await field('Skew Co');
    expect((await t.admin.post('/v1/shifts', punchIn(Date.now()))).json().error.code).toBe(
      'USE_MOBILE_APP',
    );
    expect((await t.phone.post('/v1/shifts', punchIn(Date.now() - 80 * H))).json().error.code).toBe(
      'SYNC_WINDOW',
    );
    const skewed = await t.skewed.post('/v1/shifts', punchIn(Date.now()));
    expect(skewed.json().flags).toEqual(['clock_skew']);
  });

  it('asks for a selfie when the tenant does', async () => {
    const t = await field('Selfie Co');
    expect((await t.admin.patch('/v1/settings', { attendanceSelfie: true })).statusCode).toBe(200);
    expect((await t.phone.post('/v1/shifts', punchIn(Date.now()))).json().error.code).toBe(
      'PHOTO_REQUIRED',
    );
    const unknown = await t.phone.post('/v1/shifts', {
      ...punchIn(Date.now()),
      selfieMediaId: newId(),
    });
    expect(unknown.json().error.code).toBe('NOT_FOUND');
  });

  it('ends a shift sent late at the longest it may last, and closes forgotten ones nightly', async () => {
    const t = await field('Long Co');
    const late = punchIn(Date.now() - 20 * H);
    expect((await t.phone.post('/v1/shifts', late)).statusCode).toBe(201);
    const ended = await t.phone.post(`/v1/shifts/${late.id}/end`, {
      ...FIX,
      endedAt: new Date(Date.now() - H).toISOString(),
    });
    expect(ended.json()).toMatchObject({
      endReason: 'max_length',
      endedAt: new Date(Date.parse(late.startedAt) + 14 * H).toISOString(),
    });

    const forgotten = punchIn(Date.now() - 15 * H);
    expect((await t.phone.post('/v1/shifts', forgotten)).statusCode).toBe(201);
    const closed = await world.database.forTenant(t.tenantId, (tx) =>
      app.get(ShiftsService).autoClose(tx, t.tenantId),
    );
    expect(closed).toBe(1);
    const after = (await t.phone.get(`/v1/shifts?userId=${t.userId}`)).json().items;
    expect(after[0]).toMatchObject({ id: forgotten.id, endReason: 'auto_closed' });
    // A punch-out that arrives after the nightly close leaves the shift as it was.
    const lateOut = await t.phone.post(`/v1/shifts/${forgotten.id}/end`, {
      ...FIX,
      endedAt: new Date().toISOString(),
    });
    expect(lateOut.json()).toMatchObject({ endReason: 'auto_closed' });
  });
});

describe('location points (BR-36, spec 12.1)', () => {
  it('judges each point on its own, ignores replays, and takes none after punch-out', async () => {
    const t = await field('Points Co');
    const start = Date.now() - 2 * H;
    const shift = punchIn(start);
    await t.phone.post('/v1/shifts', shift);
    const good = point(shift.id, start + 10 * 60_000);
    const batch = await t.phone.post('/v1/locations/batch', {
      points: [
        good,
        point(shift.id, start + 11 * 60_000, { mocked: true }),
        point(shift.id, start + 12 * 60_000, { accuracy: 500 }),
        point(shift.id, start - 60_000),
        point(newId(), start + 13 * 60_000),
        point(shift.id, start + 14 * 60_000, { source: 'foreground', battery: 64 }),
      ],
    });
    expect(batch.statusCode).toBe(200);
    expect(batch.json().accepted).toHaveLength(2);
    expect(batch.json().rejected.map((entry: { reason: string }) => entry.reason)).toEqual([
      'MOCKED',
      'INACCURATE',
      'OUTSIDE_SHIFT',
      'NOT_YOUR_SHIFT',
    ]);
    const replay = await t.phone.post('/v1/locations/batch', { points: [good] });
    expect(replay.json()).toEqual({ accepted: [good.id], rejected: [] });

    await t.phone.post(`/v1/shifts/${shift.id}/end`, {
      ...FIX,
      endedAt: new Date(start + H).toISOString(),
    });
    const afterOut = await t.phone.post('/v1/locations/batch', {
      points: [point(shift.id, start + H + 30_000), point(shift.id, start + H + 5 * 60_000)],
    });
    expect(afterOut.json().accepted).toHaveLength(1);
    expect(afterOut.json().rejected).toEqual([{ id: expect.any(String), reason: 'OUTSIDE_SHIFT' }]);
  });

  it("refuses another person's shift", async () => {
    const t = await field('Two Co');
    const other = await field('Other Co');
    const shift = punchIn(Date.now() - H);
    await other.phone.post('/v1/shifts', shift);
    const tried = await t.phone.post('/v1/locations/batch', {
      points: [point(shift.id, Date.now() - 30 * 60_000)],
    });
    expect(tried.json().rejected).toEqual([{ id: expect.any(String), reason: 'NOT_YOUR_SHIFT' }]);
  });
});

describe('pauses, trails and attendance (M5, decision D47)', () => {
  it('pauses and resumes, compacts the trail at punch-out, and counts the day', async () => {
    const t = await field('Trail Co');
    const start = Date.now() - 3 * H;
    const shift = punchIn(start);
    await t.phone.post('/v1/shifts', shift);
    // A walk north in steps of about 111 m, with one vague fix and a 20-minute silence.
    const walk = [0, 5, 10, 15, 40, 45].map((minutes, index) =>
      point(shift.id, start + minutes * 60_000, {
        location: { lat: HERE.lat + index * 0.001, lng: HERE.lng },
      }),
    );
    walk.push(
      point(shift.id, start + 50 * 60_000, { accuracy: 200, location: { lat: 29, lng: 78 } }),
    );
    expect(
      (await t.phone.post('/v1/locations/batch', { points: walk })).json().accepted,
    ).toHaveLength(7);

    const pauseId = newId();
    const paused = await t.phone.post(`/v1/shifts/${shift.id}/pauses`, {
      id: pauseId,
      pausedAt: new Date(start + H).toISOString(),
      reason: 'Lunch',
    });
    expect(paused.json().pauses).toEqual([
      expect.objectContaining({ id: pauseId, reason: 'Lunch', resumedAt: null }),
    ]);
    const twice = await t.phone.post(`/v1/shifts/${shift.id}/pauses`, {
      id: newId(),
      pausedAt: new Date(start + H + 60_000).toISOString(),
      reason: 'Again',
    });
    expect(twice.json().error.code).toBe('CONFLICT');
    const resumed = await t.phone.post(`/v1/shifts/${shift.id}/pauses/${pauseId}/resume`, {
      resumedAt: new Date(start + 1.5 * H).toISOString(),
    });
    expect(resumed.json().pauses[0].resumedAt).toBe(new Date(start + 1.5 * H).toISOString());

    const ended = await t.phone.post(`/v1/shifts/${shift.id}/end`, {
      ...FIX,
      endedAt: new Date(start + 2 * H).toISOString(),
    });
    expect(ended.json().onDutySeconds).toBe(1.5 * 3_600);
    // The trail followed the punch-out: about 555 m from the accurate fixes, the vague one left out.
    const [listed] = (await t.admin.get(`/v1/shifts?userId=${t.userId}`)).json().items;
    expect(listed.distanceM).toBeGreaterThan(540);
    expect(listed.distanceM).toBeLessThan(570);
    const [trail] = await world.database
      .forTenant(t.tenantId, (tx) =>
        tx.execute<{ point_count: number; kept_count: number; gaps: unknown[]; pauses: unknown[] }>(
          `select point_count, kept_count, gaps, pauses from cell.shift_trails where shift_id = '${shift.id}'`,
        ),
      )
      .then((result) => result.rows);
    expect(trail).toMatchObject({ point_count: 7, kept_count: 2 });
    expect(trail!.gaps).toHaveLength(1);
    expect(trail!.pauses).toHaveLength(1);

    const today = todayIn('Asia/Kolkata', new Date(start));
    const month = (
      await t.admin.get(`/v1/attendance?userId=${t.userId}&period=${today.slice(0, 7)}`)
    ).json();
    expect(month.days.find((day: { date: string }) => day.date === today)).toMatchObject({
      status: 'present',
      value: 1,
      hours: 1.5,
      firstIn: new Date(start).toISOString(),
      lastOut: new Date(start + 2 * H).toISOString(),
    });
    expect(month.days.find((day: { date: string }) => day.date < '2026-01-01')).toBeUndefined();
    const stored = await world.database.forTenant(t.tenantId, (tx) =>
      tx.execute<{ status: string }>(
        `select status from cell.attendance_days where user_id = '${t.userId}' and date = '${today}'`,
      ),
    );
    expect(stored.rows).toEqual([{ status: 'present' }]);
  });
});
