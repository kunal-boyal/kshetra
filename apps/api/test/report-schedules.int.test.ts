import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationDeliveries } from '../src/db/schema/notifications';
import { exportJobs, reportScheduleRuns, reportSchedules } from '../src/db/schema/reports';
import { NotificationDelivery } from '../src/modules/notifications/delivery';
import { EmailSender, type MemoryEmailSender } from '../src/modules/notifications/senders';
import { ExportsService } from '../src/modules/reports/exports.service';
import { ReportSchedulesService } from '../src/modules/reports/report-schedules.service';
import { Database } from '../src/platform/database';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Scheduled reports (M18, BR-52, decision D122). */

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

const ZONE = 'Asia/Kolkata';
const MONTH = () => todayIn(ZONE).slice(0, 7);

/** 08:00 on the 1st of a month this many months from now, on the tenant's clock. */
function firstOf(monthsAhead: number): Date {
  const [year, month] = MONTH().split('-').map(Number) as [number, number];
  const index = year * 12 + month - 1 + monthsAhead;
  const first = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
  return new Date(`${first}T08:00:00+05:30`);
}

function as(token: string) {
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object) => call('POST', url, payload),
    put: (url: string, payload: object) => call('PUT', url, payload),
    patch: (url: string, payload: object) => call('PATCH', url, payload),
  };
}

/** A tenant: its admin, a manager with Asha under them, Ravi under the admin; each signed in. */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { admin: newPhone(), manager: newPhone(), asha: newPhone() };
  const mail = (who: string) => `${who}.${newId().slice(-8)}@example.test`;
  const admin = await world.user(tenantId, {
    phone: phones.admin,
    email: mail('admin'),
    designation: 'head',
    role: 'tenant_admin',
  });
  const manager = await world.user(tenantId, {
    phone: phones.manager,
    email: mail('manager'),
    designation: 'manager',
    role: 'manager',
    managerId: admin.id,
  });
  const asha = await world.user(tenantId, {
    phone: phones.asha,
    designation: 'executive',
    managerId: manager.id,
  });
  const ravi = await world.user(tenantId, { designation: 'executive', managerId: admin.id });
  const api = {
    admin: as((await world.signIn(phones.admin)).accessToken),
    manager: as((await world.signIn(phones.manager)).accessToken),
    asha: as((await world.signIn(phones.asha, newDevice())).accessToken),
  };
  return { tenantId, admin, manager, asha, ravi, api };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

const monthly = (recipients: string[], extra: object = {}) => ({
  id: newId(),
  report: 'attendance_register',
  filters: {},
  format: 'xlsx',
  frequency: 'monthly',
  weekday: null,
  at: '07:00',
  recipients,
  ...extra,
});

/** A send's exports, as the worker would run them, then every notification delivered. */
async function sendsOf(t: Tenant, scheduleId: string) {
  const database = app.get(Database);
  const jobs = await database.forTenant(t.tenantId, (tx) =>
    tx
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.tenantId, t.tenantId), eq(exportJobs.scheduleId, scheduleId))),
  );
  for (const job of jobs) await app.get(ExportsService).run(t.tenantId, job.id);
  const waiting = await database.forTenant(t.tenantId, (tx) =>
    tx
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.tenantId, t.tenantId),
          eq(notificationDeliveries.status, 'queued'),
        ),
      ),
  );
  for (const { id } of waiting) await app.get(NotificationDelivery).deliver(t.tenantId, id);
  return database.forTenant(t.tenantId, (tx) =>
    tx
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.tenantId, t.tenantId), eq(exportJobs.scheduleId, scheduleId))),
  );
}

async function runs(t: Tenant, scheduleId: string) {
  return app.get(Database).forTenant(t.tenantId, (tx) =>
    tx
      .select()
      .from(reportScheduleRuns)
      .where(
        and(
          eq(reportScheduleRuns.tenantId, t.tenantId),
          eq(reportScheduleRuns.scheduleId, scheduleId),
        ),
      ),
  );
}

const emails = () => (app.get(EmailSender) as MemoryEmailSender).sent;

describe('scheduled reports (D122)', () => {
  it('sends each recipient the report as they may see it, by email with a link', async () => {
    const t = await tenant('Sent Co');
    const body = monthly([t.admin.id, t.manager.id]);
    const made = await t.api.admin.post('/v1/report-schedules', body);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      status: 'active',
      nextSend: expect.stringMatching(/-01$/),
      recipients: [
        expect.objectContaining({ id: t.admin.id }),
        expect.objectContaining({ id: t.manager.id }),
      ],
    });
    // On the 1st it sends this month complete; looked at again, it sends nothing more.
    const schedules = app.get(ReportSchedulesService);
    await schedules.due(t.tenantId, firstOf(1));
    await schedules.due(t.tenantId, firstOf(1));
    expect(await runs(t, body.id)).toEqual([expect.objectContaining({ period: MONTH() })]);
    const jobs = await sendsOf(t, body.id);
    expect(jobs).toHaveLength(2);
    const mine = jobs.find((job) => job.createdBy === t.admin.id)!;
    const theirs = jobs.find((job) => job.createdBy === t.manager.id)!;
    expect(mine.status).toBe('ready');
    expect(theirs.status).toBe('ready');
    // The admin sees everyone's days; the manager only theirs and their team's.
    expect(mine.rowCount!).toBeGreaterThan(theirs.rowCount!);
    // Each export is its recipient's alone.
    expect((await t.api.manager.get(`/v1/exports/${theirs.id}`)).json()).toMatchObject({
      status: 'ready',
      download: expect.objectContaining({ url: expect.any(String) }),
    });
    expect((await t.api.admin.get(`/v1/exports/${theirs.id}`)).statusCode).toBe(404);
    // The email links to the export in the portal, and carries no figures.
    const told = emails().find((message) => message.to === t.manager.email)!;
    expect(told.subject).toBe('Your scheduled report is ready');
    expect(told.text).toContain(`/reports?export=${theirs.id}`);
    // The owner sees the send and each recipient's outcome.
    const detail = (await t.api.admin.get(`/v1/report-schedules/${body.id}`)).json();
    expect(detail.runs).toEqual([
      expect.objectContaining({
        period: MONTH(),
        exports: expect.arrayContaining([
          expect.objectContaining({
            user: expect.objectContaining({ id: t.manager.id }),
            status: 'ready',
          }),
        ]),
      }),
    ]);
    // The manager sees it among those sent to them, with only themselves as recipient.
    const sentToMe = (await t.api.manager.get('/v1/report-schedules?for=me')).json().items;
    expect(sentToMe).toEqual([
      expect.objectContaining({
        id: body.id,
        recipients: [expect.objectContaining({ id: t.manager.id })],
      }),
    ]);
  });

  it('refuses a recipient out of reach or who may not export, and a weekly send without a day', async () => {
    const t = await tenant('Refused Co');
    const outOfTeam = await t.api.manager.post('/v1/report-schedules', monthly([t.ravi.id]));
    expect(outOfTeam.statusCode).toBe(400);
    expect(outOfTeam.json().error.details).toEqual([
      expect.objectContaining({ path: 'recipients[0]' }),
    ]);
    const fieldUser = await t.api.manager.post('/v1/report-schedules', monthly([t.asha.id]));
    expect(fieldUser.statusCode).toBe(400);
    const noDay = await t.api.admin.post(
      '/v1/report-schedules',
      monthly([t.admin.id], { frequency: 'weekly' }),
    );
    expect(noDay.statusCode).toBe(400);
    // A field user may not schedule at all.
    expect((await t.api.asha.post('/v1/report-schedules', monthly([t.asha.id]))).statusCode).toBe(
      403,
    );
  });

  it('sends once for the latest moment missed, and a workbook as one file', async () => {
    const t = await tenant('Missed Co');
    const body = monthly([t.admin.id], { report: 'workbook' });
    expect((await t.api.admin.post('/v1/report-schedules', body)).statusCode).toBe(201);
    // Down for three months: one send, for the latest 1st.
    await app.get(ReportSchedulesService).due(t.tenantId, firstOf(3));
    const made = await runs(t, body.id);
    expect(made).toHaveLength(1);
    expect(made[0]!.sendDate).toBe(todayIn(ZONE, firstOf(3)));
    const [job] = await sendsOf(t, body.id);
    expect(job).toMatchObject({ report: 'workbook', status: 'ready' });
  });

  it('pauses when its owner may no longer schedule, and stops for a recipient who leaves', async () => {
    const t = await tenant('Paused Co');
    // The admin sends to both; the manager leaves it.
    const theirs = monthly([t.admin.id, t.manager.id]);
    expect((await t.api.admin.post('/v1/report-schedules', theirs)).statusCode).toBe(201);
    expect((await t.api.manager.post(`/v1/report-schedules/${theirs.id}/leave`)).statusCode).toBe(
      200,
    );
    expect((await t.api.manager.get('/v1/report-schedules?for=me')).json().items).toEqual([]);
    // The manager's own, to themselves; then they stop being allowed to schedule.
    const body = monthly([t.manager.id]);
    expect((await t.api.manager.post('/v1/report-schedules', body)).statusCode).toBe(201);
    const roles = (await t.api.admin.get('/v1/roles')).json().items as {
      id: string;
      key: string;
      permissions: string[];
    }[];
    const manager = roles.find((role) => role.key === 'manager')!;
    const changed = await t.api.admin.patch(`/v1/roles/${manager.id}`, {
      permissions: manager.permissions.filter((permission) => permission !== 'report.schedule'),
    });
    expect(changed.statusCode).toBe(200);
    await app.get(ReportSchedulesService).due(t.tenantId, firstOf(1));
    expect(await runs(t, body.id)).toEqual([]);
    const [sent] = await sendsOf(t, theirs.id);
    expect(sent).toMatchObject({ createdBy: t.admin.id });
    const [schedule] = await app.get(Database).forTenant(t.tenantId, (tx) =>
      tx
        .select({ status: reportSchedules.status, reason: reportSchedules.pausedReason })
        .from(reportSchedules)
        .where(and(eq(reportSchedules.tenantId, t.tenantId), eq(reportSchedules.id, body.id))),
    );
    expect(schedule).toEqual({ status: 'paused', reason: 'owner_access' });
  });

  it('sends nothing while the module is off, and ends with its erased owner', async () => {
    const t = await tenant('Off Co');
    const body = monthly([t.admin.id]);
    expect((await t.api.admin.post('/v1/report-schedules', body)).statusCode).toBe(201);
    expect(
      (await t.api.admin.patch('/v1/settings', { modulesOff: ['advanced_analytics'] })).statusCode,
    ).toBe(200);
    await app.get(ReportSchedulesService).due(t.tenantId, firstOf(1));
    expect(await runs(t, body.id)).toEqual([]);
    await app
      .get(Database)
      .forTenant(t.tenantId, (tx) =>
        app.get(ReportSchedulesService).erasePerson(tx, t.tenantId, t.admin.id),
      );
    expect((await t.api.admin.get('/v1/report-schedules?for=me')).json().error.code).toBe(
      'MODULE_DISABLED',
    );
    expect((await t.api.admin.patch('/v1/settings', { modulesOff: [] })).statusCode).toBe(200);
    expect((await t.api.admin.get('/v1/report-schedules?for=me')).json().items).toEqual([]);
    expect((await t.api.admin.get('/v1/report-schedules')).json().items).toEqual([]);
  });

  it('lets only its owner change, pause and end it', async () => {
    const t = await tenant('Owned Co');
    const body = monthly([t.admin.id, t.manager.id]);
    expect((await t.api.admin.post('/v1/report-schedules', body)).statusCode).toBe(201);
    expect(
      (await t.api.manager.put(`/v1/report-schedules/${body.id}`, { status: 'paused' })).statusCode,
    ).toBe(404);
    const paused = await t.api.admin.put(`/v1/report-schedules/${body.id}`, {
      status: 'paused',
      frequency: 'weekly',
      weekday: 1,
      recipients: [t.admin.id],
    });
    expect(paused.json()).toMatchObject({
      status: 'paused',
      pausedReason: 'by_owner',
      frequency: 'weekly',
      nextSend: null,
      recipients: [expect.objectContaining({ id: t.admin.id })],
    });
    const ended = await t.api.admin.post(`/v1/report-schedules/${body.id}/end`);
    expect(ended.json()).toMatchObject({ endedAt: expect.any(String) });
    expect((await t.api.admin.get('/v1/report-schedules')).json().items).toEqual([]);
  });
});
