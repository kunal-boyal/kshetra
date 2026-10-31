import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import readXlsxFile from 'read-excel-file/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportJobs } from '../src/db/schema/reports';
import { MediaService } from '../src/modules/media/media.service';
import { ExportsService } from '../src/modules/reports/exports.service';
import { Database } from '../src/platform/database';
import { Queues } from '../src/platform/queues';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Reports and exports (M18): the activity log, the attendance register, target against achievement. */

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
const MONTH = () => todayIn('Asia/Kolkata').slice(0, 7);

function as(token: string) {
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object) => call('POST', url, payload),
  };
}

type Api = ReturnType<typeof as>;

const fix = (at: number) => ({
  location: HERE,
  accuracy: 15,
  mocked: false,
  capturedAt: new Date(at).toISOString(),
});

/**
 * A tenant with its admin, a manager with Asha reporting to them, and Ravi reporting to the admin.
 * Asha punched in two hours ago and filled a form of the tenant's own at her shop, its outcome
 * starting like a spreadsheet formula.
 */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { admin: newPhone(), manager: newPhone(), asha: newPhone(), ravi: newPhone() };
  const admin = await world.user(tenantId, {
    phone: phones.admin,
    designation: 'head',
    role: 'tenant_admin',
  });
  const manager = await world.user(tenantId, {
    phone: phones.manager,
    designation: 'manager',
    role: 'manager',
    managerId: admin.id,
  });
  const asha = await world.user(tenantId, {
    phone: phones.asha,
    designation: 'executive',
    managerId: manager.id,
  });
  const ravi = await world.user(tenantId, {
    phone: phones.ravi,
    designation: 'executive',
    managerId: admin.id,
  });
  const api = {
    admin: as((await world.signIn(phones.admin)).accessToken),
    manager: as((await world.signIn(phones.manager)).accessToken),
    asha: as((await world.signIn(phones.asha, newDevice())).accessToken),
  };
  const shop = newId();
  const made = await api.admin.post('/v1/accounts', {
    id: shop,
    type: 'customer',
    code: `C-${newId().slice(-8)}`,
    name: 'Sharma Stores',
    territoryId: await world.territory(tenantId, `T-${newId().slice(-6)}`),
    location: HERE,
    slots: { executive: asha.id },
  });
  expect(made.statusCode).toBe(201);
  // Two hours ago, or just after midnight on the tenant's clock if that is sooner, so the shift
  // falls on today whenever the test runs.
  const midnight = Date.parse(`${todayIn('Asia/Kolkata')}T00:01:00+05:30`);
  const start = Math.max(Date.now() - 2 * H, midnight);
  expect(
    (
      await api.asha.post('/v1/shifts', {
        id: newId(),
        startedAt: new Date(start).toISOString(),
        location: HERE,
        accuracy: 15,
        mocked: false,
        consentVersion: '2026-10',
      })
    ).statusCode,
  ).toBe(201);
  const text = (en: string) => ({ en, hi: en });
  const form = await api.admin.post('/v1/forms', {
    definition: {
      key: 'shop_note',
      name: {
        en: { one: 'Shop note', other: 'Shop notes' },
        hi: { one: 'दुकान नोट', other: 'दुकान नोट' },
      },
      icon: 'clipboard-check',
      accountLink: { mode: 'required', accountTypes: ['customer'] },
      shift: 'required',
      review: 'manual',
      geofence: 'advisory',
      signature: 'none',
      photos: { min: 0, max: 2, source: 'camera' },
      fields: [
        { key: 'person_met', type: 'short_text', label: text('Person met') },
        { key: 'outcome', type: 'long_text', label: text('Outcome') },
      ],
    },
  });
  expect(form.statusCode).toBe(201);
  const submitted = await api.asha.post('/v1/submissions', {
    id: newId(),
    form: { key: 'shop_note', version: 1 },
    accountId: shop,
    capturedAt: new Date().toISOString(),
    fix: fix(Date.now()),
    values: { person_met: 'Mr Sharma', outcome: '=HYPERLINK("http://example.test")' },
    photos: [],
  });
  expect(submitted.json()).toMatchObject({ id: expect.any(String) });
  return { tenantId, admin, manager, asha, ravi, api, shop };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

const report = (api: Api, key: string, query = '') =>
  api.get(`/v1/reports/${key}?period=${MONTH()}${query}`);

/** Asks for an export, runs the worker's step, and reads it back. */
async function exported(t: Tenant, body: object) {
  const id = newId();
  const asked = await t.api.manager.post('/v1/exports', { id, ...body });
  expect(asked.statusCode).toBe(201);
  expect(asked.json()).toMatchObject({ id, status: 'queued', download: null });
  await app.get(ExportsService).run(t.tenantId, id);
  return { id, result: (await t.api.manager.get(`/v1/exports/${id}`)).json() };
}

/** The file an export wrote. */
async function fileOf(t: Tenant, id: string): Promise<Uint8Array> {
  return app.get(Database).forTenant(t.tenantId, async (tx) => {
    const [job] = await tx
      .select({ mediaId: exportJobs.fileMediaId })
      .from(exportJobs)
      .where(and(eq(exportJobs.tenantId, t.tenantId), eq(exportJobs.id, id)));
    return (await app.get(MediaService).read(tx, t.tenantId, job!.mediaId!)).bytes;
  });
}

describe('reports on screen (M18)', () => {
  it('logs every submission in scope with where it was filled and its review status', async () => {
    const t = await tenant('Log Co');
    const page = (await report(t.api.manager, 'activity_log')).json();
    expect(page.columns.map((column: { label: string }) => column.label)).toContain('Geofence');
    expect(page.rows).toEqual([
      expect.objectContaining({
        user_name: t.asha.name,
        form: 'Shop note',
        account_name: 'Sharma Stores',
        geofence: 'Inside the geofence',
        status: 'Waiting for review',
        values: expect.stringContaining('Mr Sharma'),
      }),
    ]);
    // The status column gives each value, as the reader sees it, its badge's tone.
    expect(page.columns).toContainEqual({
      key: 'status',
      label: 'Review status',
      kind: 'status',
      tones: { 'Waiting for review': 'pending', Approved: 'success', Rejected: 'danger' },
    });
    // One form chosen: its fields become columns, in the language asked for.
    const chosen = (
      await report(t.api.manager, 'activity_log', '&form=shop_note&locale=hi')
    ).json();
    expect(chosen.columns.map((column: { key: string }) => column.key)).toContain(
      'field_person_met',
    );
    expect(chosen.rows[0]).toMatchObject({
      field_person_met: 'Mr Sharma',
      geofence: 'दायरे के भीतर',
    });
    const status = chosen.columns.find((column: { key: string }) => column.key === 'status');
    expect(status.tones[chosen.rows[0].status]).toBe('pending');
    // Ravi reports to the admin, outside the manager's team.
    expect(
      (await report(t.api.manager, 'activity_log', `&userId=${t.ravi.id}`)).json().error.code,
    ).toBe('OUT_OF_SCOPE');
    expect(
      (await report(t.api.manager, 'activity_log', `&userId=${newId()}`)).json().error.code,
    ).toBe('NOT_FOUND');
    expect((await report(t.api.asha, 'activity_log')).json().error.code).toBe('FORBIDDEN');
    expect((await t.api.manager.get(`/v1/reports/nothing?period=${MONTH()}`)).statusCode).toBe(404);
  });

  it('keeps an attendance register by person and day', async () => {
    const t = await tenant('Register Co');
    const page = (
      await report(t.api.manager, 'attendance_register', `&userId=${t.asha.id}`)
    ).json();
    const today = page.rows.find((row: { date: string }) => row.date === todayIn('Asia/Kolkata'));
    expect(today).toMatchObject({
      user_name: t.asha.name,
      shifts: 1,
      first_in: expect.any(String),
      last_out: null,
    });
    expect(today.hours).toBeGreaterThan(0);
    // Every day of the month, one person per page here.
    const days = Number(
      new Date(Date.UTC(Number(MONTH().slice(0, 4)), Number(MONTH().slice(5)), 0)).getUTCDate(),
    );
    expect(page.rows).toHaveLength(days);
    // The manager's team: the manager and Asha, a page of whole months.
    const team = (
      await report(t.api.admin, 'attendance_register', `&managerId=${t.manager.id}&limit=40`)
    ).json();
    expect(new Set(team.rows.map((row: { user_name: string }) => row.user_name)).size).toBe(1);
    expect(team.nextCursor).toBe('1');
  });

  it('sets each person’s metrics against their targets', async () => {
    const t = await tenant('Target Co');
    const page = (await report(t.api.manager, 'target_achievement', `&userId=${t.asha.id}`)).json();
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows[0]).toMatchObject({ user_name: t.asha.name, designation: 'executive' });
    expect(page.columns.map((column: { key: string }) => column.key)).toEqual([
      'user_code',
      'user_name',
      'designation',
      'metric',
      'target',
      'achieved',
      'pending',
      'attainment',
      'score',
    ]);
  });
});

describe('the home dashboard (M18)', () => {
  it("shows a manager their team's month, and a field user their own", async () => {
    const t = await tenant('Home Co');
    const team = (await t.api.manager.get(`/v1/dashboard?period=${MONTH()}`)).json();
    expect(team).toMatchObject({
      period: MONTH(),
      view: 'team',
      people: 1,
      onDuty: 1,
      waiting: { reviews: 1, approvals: 0 },
      mix: [
        {
          form: { key: 'shop_note', name: { en: { one: 'Shop note' } } },
          approved: 0,
          pending: 1,
          rejected: 0,
        },
      ],
    });
    expect(team.tiles.length).toBeGreaterThan(0);
    expect(team.tiles.length).toBeLessThanOrEqual(6);
    for (const line of team.trend) {
      expect(team.tiles.map((tile: { metric: { key: string } }) => tile.metric.key)).toContain(
        line.key,
      );
    }

    const own = (await t.api.asha.get(`/v1/dashboard?period=${MONTH()}`)).json();
    expect(own).toMatchObject({
      view: 'self',
      people: 1,
      onDuty: null,
      waiting: { reviews: null, approvals: null },
    });
    expect(own.mix[0]).toMatchObject({ pending: 1 });
    expect((await t.api.asha.get('/v1/dashboard?period=2026-13')).statusCode).toBe(400);

    // The rail's counts are the dashboard's own part, read alone (phase U, decision D104).
    expect((await t.api.manager.get('/v1/dashboard/waiting')).json()).toEqual(team.waiting);
    expect((await t.api.asha.get('/v1/dashboard/waiting')).json()).toEqual({
      reviews: null,
      approvals: null,
      plans: null,
      leave: null,
      expenses: null,
    });
  });

  it('lists who is on duty with their place and visits, and counts leave waiting', async () => {
    const t = await tenant('Duty Co');
    const visit = await t.api.asha.post('/v1/visits', {
      id: newId(),
      accountId: t.shop,
      checkedInAt: new Date().toISOString(),
      fix: fix(Date.now()),
    });
    expect(visit.statusCode, visit.body).toBe(201);
    // A Tuesday early next year, so it is a working day well ahead.
    const day = new Date(Date.UTC(Number(todayIn('Asia/Kolkata').slice(0, 4)) + 1, 2, 2));
    while (day.getUTCDay() !== 2) day.setUTCDate(day.getUTCDate() + 1);
    const date = day.toISOString().slice(0, 10);
    const leave = await t.api.asha.post('/v1/leave-requests', {
      id: newId(),
      leaveType: 'casual',
      startDate: date,
      endDate: date,
    });
    expect(leave.statusCode, leave.body).toBe(201);

    const team = (await t.api.manager.get(`/v1/dashboard?period=${MONTH()}`)).json();
    expect(team).toMatchObject({
      onDuty: 1,
      onDutyPeople: [
        {
          user: { id: t.asha.id, name: expect.any(String) },
          place: 'Sharma Stores',
          visits: 1,
          paused: false,
        },
      ],
      onLeaveToday: 0,
      waiting: { approvals: 1, plans: 0, leave: 1, expenses: 0 },
    });

    const own = (await t.api.asha.get(`/v1/dashboard?period=${MONTH()}`)).json();
    expect(own).toMatchObject({ onDutyPeople: null, onLeaveToday: null });
  });
});

describe('exports (M18)', () => {
  it('writes an XLSX in the background, keeps it a week, and links only its owner to it', async () => {
    const t = await tenant('Excel Co');
    const filters = { period: MONTH(), managerId: t.manager.id, form: 'shop_note' };
    const { id, result } = await exported(t, {
      report: 'activity_log',
      filters,
      format: 'xlsx',
      locale: 'en',
    });
    expect(result).toMatchObject({
      status: 'ready',
      rows: 1,
      fileName: `activity-log-${MONTH()}.xlsx`,
      download: { url: expect.any(String) },
    });
    expect(Date.parse(result.expiresAt) - Date.parse(result.finishedAt)).toBe(7 * 24 * H);
    const sheet = (await readXlsxFile(Buffer.from(await fileOf(t, id))))[0]!.data;
    expect(sheet[0]).toContain('Geofence');
    expect(sheet[1]).toContain('Sharma Stores');
    // The outcome, in its own column, starts like a formula and is written as text.
    expect(String(sheet[1]!.at(-1))).toContain(`'=HYPERLINK`);
    expect((await t.api.admin.get(`/v1/exports/${id}`)).json().error.code).toBe('NOT_FOUND');
    expect((await t.api.manager.get('/v1/exports')).json().items).toEqual([
      expect.objectContaining({ id, status: 'ready', download: null }),
    ]);

    // After seven days the file goes.
    await app.get(ExportsService).expire(t.tenantId, new Date(Date.now() + 8 * 24 * H));
    expect((await t.api.manager.get(`/v1/exports/${id}`)).json()).toMatchObject({
      status: 'expired',
      download: null,
    });
  });

  it('writes every report the person may see into one workbook, a sheet each (D112)', async () => {
    const t = await tenant('Workbook Co');
    const filters = { period: MONTH(), managerId: t.manager.id, form: 'shop_note' };
    const refused = await t.api.manager.post('/v1/exports', {
      id: newId(),
      report: 'workbook',
      filters,
      format: 'csv',
      locale: 'en',
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.details).toEqual([{ path: 'format', issue: 'Choose xlsx' }]);

    const { id, result } = await exported(t, {
      report: 'workbook',
      filters,
      format: 'xlsx',
      locale: 'en',
    });
    expect(result).toMatchObject({
      report: 'workbook',
      status: 'ready',
      fileName: `reports-${MONTH()}.xlsx`,
    });
    const sheets = await readXlsxFile(Buffer.from(await fileOf(t, id)));
    const names = sheets.map((sheet) => sheet.sheet);
    expect(names.length).toBeGreaterThan(3);
    // One person's points need a person; the audit log needs its own permission.
    expect(names).not.toContain('GPS audit trail');
    expect(names).not.toContain('Audit log');
    // The activity log holds every form's work, as the one-form filter is the screen's alone.
    const log = sheets.find((sheet) => sheet.data.some((row) => row.includes('Sharma Stores')));
    expect(log, names.join(', ')).toBeDefined();
    expect(result.rows).toBe(sheets.reduce((sum, sheet) => sum + sheet.data.length - 1, 0));
  });

  it('writes CSV with Hindi headings, and refuses filters out of reach before queueing', async () => {
    const t = await tenant('CSV Co');
    const { id, result } = await exported(t, {
      report: 'attendance_register',
      filters: { period: MONTH(), userId: t.asha.id },
      format: 'csv',
      locale: 'hi',
    });
    expect(result.status).toBe('ready');
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await fileOf(t, id));
    expect(text.startsWith('﻿तारीख़,')).toBe(true);
    expect(text).toContain('उपस्थित');
    const refused = await t.api.manager.post('/v1/exports', {
      id: newId(),
      report: 'activity_log',
      filters: { period: MONTH(), userId: t.ravi.id },
      format: 'csv',
    });
    expect(refused.json().error.code).toBe('OUT_OF_SCOPE');
  });

  it('tells the person when the file is ready', async () => {
    const t = await tenant('Told Co');
    await exported(t, {
      report: 'target_achievement',
      filters: { period: MONTH() },
      format: 'xlsx',
    });
    const inbox = await t.api.manager.get('/v1/notifications');
    expect(inbox.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'export.finished', link: '/reports' }),
      ]),
    );
  });

  it('runs on the worker, and the hourly sweep queues again one left waiting', async () => {
    const t = await tenant('Worker Co');
    app.get(Queues).startWorkers();
    const until = async (id: string) => {
      const deadline = Date.now() + 15_000;
      let status = '';
      while (Date.now() < deadline && status !== 'ready') {
        status = (await t.api.manager.get(`/v1/exports/${id}`)).json().status;
        if (status !== 'ready') await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return status;
    };
    const id = newId();
    await t.api.manager.post('/v1/exports', {
      id,
      report: 'attendance_register',
      filters: { period: MONTH() },
      format: 'csv',
    });
    expect(await until(id)).toBe('ready');

    // One that never reached the queue, as if its hand-off failed after the commit.
    const stuck = newId();
    await app.get(Database).forTenant(t.tenantId, (tx) =>
      tx.insert(exportJobs).values({
        id: stuck,
        tenantId: t.tenantId,
        report: 'attendance_register',
        filters: { period: MONTH() },
        format: 'csv',
        locale: 'en',
        createdBy: t.manager.id,
        createdAt: new Date(Date.now() - 10 * 60_000),
      }),
    );
    await app.get(ExportsService).expire(t.tenantId);
    expect(await until(stuck)).toBe('ready');
  });
});
