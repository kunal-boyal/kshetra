import { newId, timeIn, todayIn } from '@kshetra/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationDeliveries, notifications } from '../src/db/schema';
import { NotificationDelivery } from '../src/modules/notifications/delivery';
import { NotificationsUpkeep } from '../src/modules/notifications/notifications.upkeep';
import {
  EmailSender,
  type MemoryEmailSender,
  type MemoryPushSender,
  type MemorySmsSender,
  PushSender,
  SmsSender,
} from '../src/modules/notifications/senders';
import { Database } from '../src/platform/database';
import { Outbox } from '../src/platform/outbox';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Notifications (M16): the inbox, deliveries with fallback, mutes, quiet hours, schedules. */

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
const TOKEN = () => `ExponentPushToken[${newId().slice(0, 22)}]`;
const noun = (one: string) => ({ en: { one, other: `${one}s` }, hi: { one: 'नोट', other: 'नोट' } });

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

type Api = ReturnType<typeof as>;

const push = () => app.get(PushSender) as MemoryPushSender;
const sms = () => app.get(SmsSender) as MemorySmsSender;
const email = () => app.get(EmailSender) as MemoryEmailSender;

/**
 * A tenant with its admin, a manager on a phone with Asha reporting to them on hers, a reviewed
 * `note` form, quiet hours off, and Asha on shift.
 */
async function tenant(name: string, shiftStartedAgo = 5 * 60_000) {
  const tenantId = await world.tenant(name);
  const phones = { admin: newPhone(), manager: newPhone(), asha: newPhone() };
  const admin = await world.user(tenantId, {
    phone: phones.admin,
    designation: 'head',
    role: 'tenant_admin',
    email: `admin-${newId().slice(-8)}@example.test`,
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
  const api = {
    admin: as((await world.signIn(phones.admin)).accessToken),
    manager: as((await world.signIn(phones.manager, newDevice())).accessToken),
    asha: as((await world.signIn(phones.asha, newDevice())).accessToken),
  };
  expect(
    (await api.admin.patch('/v1/settings', { quietHoursStart: '00:00', quietHoursEnd: '00:00' }))
      .statusCode,
  ).toBe(200);
  const made = await api.admin.post('/v1/forms', {
    definition: {
      key: 'note',
      name: noun('Note'),
      icon: 'notebook-pen',
      review: 'manual',
      fields: [{ key: 'text', type: 'short_text', label: { en: 'Text', hi: 'Text' } }],
    },
  });
  expect(made.statusCode).toBe(201);
  const shift = await api.asha.post('/v1/shifts', {
    id: newId(),
    startedAt: new Date(Date.now() - shiftStartedAgo).toISOString(),
    location: HERE,
    accuracy: 15,
    mocked: false,
    consentVersion: '2026-10',
  });
  expect(shift.statusCode).toBe(201);
  return { tenantId, admin, manager, asha, api, phones };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

/** A shop Asha looks after, with a visit planned there today. */
async function planToday(t: Tenant) {
  const accountId = newId();
  const made = await t.api.admin.post('/v1/accounts', {
    id: accountId,
    type: 'customer',
    code: `C-${newId().slice(-8)}`,
    name: 'Sharma Stores',
    territoryId: await world.territory(t.tenantId, `T-${newId().slice(-6)}`),
    slots: { executive: t.asha.id },
  });
  expect(made.statusCode).toBe(201);
  const planned = await t.api.manager.post('/v1/plan-items', {
    id: newId(),
    userId: t.asha.id,
    accountId,
    date: todayIn('Asia/Kolkata'),
    purpose: 'Collect payment',
  });
  expect(planned.statusCode).toBe(201);
}

async function submit(api: Api) {
  const id = newId();
  const sent = await api.post('/v1/submissions', {
    id,
    form: { key: 'note', version: 1 },
    capturedAt: new Date().toISOString(),
    fix: { location: HERE, accuracy: 12, mocked: false, capturedAt: new Date().toISOString() },
    values: { text: 'All well' },
  });
  expect(sent.statusCode).toBe(201);
  return id;
}

async function reject(t: Tenant, id: string, note = 'Photo of another shop') {
  const reply = await t.api.manager.post(`/v1/submissions/${id}/review`, {
    decision: 'rejected',
    note,
  });
  expect(reply.statusCode).toBe(200);
}

/** Runs every delivery waiting for this tenant, as the worker would, until none waits. */
async function deliverAll(t: Tenant) {
  const database = app.get(Database);
  for (let round = 0; round < 5; round += 1) {
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
    if (waiting.length === 0) return;
    for (const { id } of waiting) await app.get(NotificationDelivery).deliver(t.tenantId, id);
  }
}

async function deliveries(t: Tenant, userId: string) {
  return app.get(Database).forTenant(t.tenantId, (tx) =>
    tx
      .select({
        event: notifications.event,
        channel: notificationDeliveries.channel,
        status: notificationDeliveries.status,
        error: notificationDeliveries.error,
        costUnits: notificationDeliveries.costUnits,
      })
      .from(notificationDeliveries)
      .innerJoin(
        notifications,
        and(
          eq(notifications.tenantId, notificationDeliveries.tenantId),
          eq(notifications.id, notificationDeliveries.notificationId),
        ),
      )
      .where(and(eq(notifications.tenantId, t.tenantId), eq(notifications.userId, userId)))
      .orderBy(notificationDeliveries.createdAt),
  );
}

describe('the inbox (M16)', () => {
  it('tells the submitter of a rejection, by push in the phone’s language once it registers', async () => {
    const t = await tenant('Reject Co');
    await reject(t, await submit(t.api.asha));
    const inbox = (await t.api.asha.get('/v1/notifications')).json();
    expect(inbox).toMatchObject({ unread: 1, nextCursor: null });
    expect(inbox.items[0]).toMatchObject({
      event: 'submission.rejected',
      category: 'review',
      values: { form_en: 'Note', form_hi: 'नोट', note: 'Photo of another shop' },
      readAt: null,
    });
    // No phone registered yet: push is skipped, and a rejection has no other channel.
    await deliverAll(t);
    expect(await deliveries(t, t.asha.id)).toEqual([
      expect.objectContaining({ channel: 'push', status: 'skipped' }),
    ]);

    const token = TOKEN();
    expect((await t.api.asha.put('/v1/push-tokens', { token, locale: 'hi' })).statusCode).toBe(204);
    expect(
      (await t.api.admin.put('/v1/push-tokens', { token: TOKEN(), locale: 'en' })).json().error
        .code,
    ).toBe('FORBIDDEN');
    await reject(t, await submit(t.api.asha), 'Blurred');
    await deliverAll(t);
    const sent = push().sent.filter((message) => message.token === token);
    expect(sent).toEqual([
      expect.objectContaining({
        title: 'फ़ॉर्म अस्वीकृत',
        body: expect.stringContaining('Blurred'),
      }),
    ]);
    expect(sent[0]!.body).toContain('नोट');

    // A phone that uninstalled the app loses its token.
    push().refused.add(token);
    await reject(t, await submit(t.api.asha), 'Again');
    await deliverAll(t);
    const last = (await deliveries(t, t.asha.id)).at(-1);
    expect(last).toMatchObject({ channel: 'push', status: 'failed' });
    await reject(t, await submit(t.api.asha), 'Once more');
    await deliverAll(t);
    expect((await deliveries(t, t.asha.id)).at(-1)).toMatchObject({ status: 'skipped' });
  });

  it('pages newest first, marks read only the caller’s own, and keeps the unread count', async () => {
    const t = await tenant('Inbox Co');
    for (let index = 0; index < 3; index += 1) await reject(t, await submit(t.api.asha));
    const first = (await t.api.asha.get('/v1/notifications?limit=2')).json();
    expect(first.items).toHaveLength(2);
    expect(first.unread).toBe(3);
    const rest = (
      await t.api.asha.get(
        `/v1/notifications?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
      )
    ).json();
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
    const ids = [...first.items, ...rest.items].map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(3);

    expect(
      (await t.api.manager.post('/v1/notifications/read', { ids: [ids[0]] })).json().unread,
    ).toBe(0);
    expect((await t.api.asha.get('/v1/notifications')).json().unread).toBe(3);
    expect((await t.api.asha.post('/v1/notifications/read', { ids: [ids[0]] })).json()).toEqual({
      unread: 2,
    });
    expect((await t.api.asha.post('/v1/notifications/read', { all: true })).json().unread).toBe(0);
    expect((await t.api.asha.get('/v1/notifications?unread=true')).json().items).toEqual([]);
  });
});

describe('preferences and quiet hours (M16)', () => {
  it('mutes what may be muted: the inbox keeps it, nothing else is sent', async () => {
    const t = await tenant('Mute Co');
    await t.api.asha.put('/v1/push-tokens', { token: TOKEN(), locale: 'en' });
    expect(
      (await t.api.asha.put('/v1/notification-prefs', { muted: ['tracking'] })).json().error,
    ).toMatchObject({ code: 'VALIDATION' });
    const prefs = (await t.api.asha.put('/v1/notification-prefs', { muted: ['review'] })).json();
    expect(prefs.categories).toContainEqual({ category: 'review', muted: true, mutable: true });
    expect(prefs.categories).toContainEqual({
      category: 'approvals',
      muted: false,
      mutable: false,
    });
    await reject(t, await submit(t.api.asha));
    await deliverAll(t);
    expect((await t.api.asha.get('/v1/notifications')).json().unread).toBe(1);
    expect(await deliveries(t, t.asha.id)).toEqual([]);
  });

  it('holds non-urgent push in quiet hours', async () => {
    const t = await tenant('Quiet Co');
    const [hours] = timeIn('Asia/Kolkata').split(':').map(Number) as [number, number];
    const hour = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;
    const quiet = await t.api.admin.patch('/v1/settings', {
      quietHoursStart: hour(hours),
      quietHoursEnd: hour(hours + 2),
    });
    expect(quiet.statusCode).toBe(200);
    await reject(t, await submit(t.api.asha));
    expect(await deliveries(t, t.asha.id)).toEqual([
      expect.objectContaining({ channel: 'push', status: 'held' }),
    ]);
  });
});

describe('scheduled notifications (M16)', () => {
  it("tells field users of today's plan once, falling back to SMS without push", async () => {
    const t = await tenant('Plan Co');
    await planToday(t);
    const upkeep = app.get(NotificationsUpkeep);
    // A time of today on the tenant's clock: Asia/Kolkata is UTC+05:30, and its today, not UTC's,
    // as the two dates differ from midnight to 05:30 there.
    const at = (time: string) => new Date(`${todayIn('Asia/Kolkata')}T${time}:00+05:30`);
    await t.api.admin.patch('/v1/settings', { planNotificationTime: '08:00' });
    expect(await upkeep.morningPlan(t.tenantId, at('07:30'))).toBe(0);
    expect(await upkeep.morningPlan(t.tenantId, at('08:05'))).toBe(1);
    expect(await upkeep.morningPlan(t.tenantId, at('08:20'))).toBe(0);
    expect(await upkeep.morningPlan(t.tenantId, at('12:00'))).toBe(0);
    await deliverAll(t);
    expect(await deliveries(t, t.asha.id)).toEqual([
      expect.objectContaining({ event: 'plan.today', channel: 'push', status: 'skipped' }),
      expect.objectContaining({
        event: 'plan.today',
        channel: 'sms',
        status: 'sent',
        costUnits: 1,
      }),
    ]);
    expect(sms().sent.filter((message) => message.phone === t.phones.asha)).toEqual([
      expect.objectContaining({ text: expect.stringContaining('1 ') }),
    ]);
  });

  it('tells the person when tracking stops, and their manager after 40 minutes, once per gap', async () => {
    const t = await tenant('Silent Co', 2 * H);
    const upkeep = app.get(NotificationsUpkeep);
    expect(await upkeep.trackingStopped(t.tenantId)).toBe(2);
    expect(await upkeep.trackingStopped(t.tenantId)).toBe(0);
    const mine = (await t.api.asha.get('/v1/notifications')).json().items;
    expect(mine).toEqual([expect.objectContaining({ event: 'tracking.stopped' })]);
    const managers = (await t.api.manager.get('/v1/notifications')).json().items;
    expect(managers).toEqual([
      expect.objectContaining({
        event: 'tracking.stopped_report',
        values: { name: 'Test Person' },
      }),
    ]);
  });

  it('tells approvers of a request, the requester of its decision, and who imported of the result', async () => {
    const t = await tenant('Request Co');
    await t.api.admin.patch('/v1/settings', { journeyPlanApproval: true });
    const period = todayIn('Asia/Kolkata').slice(0, 7);
    await planToday(t);
    const sent = await t.api.asha.post('/v1/plans/submit', { userId: t.asha.id, period });
    expect(sent.statusCode).toBe(200);
    const waiting = (await t.api.manager.get('/v1/notifications')).json().items;
    expect(waiting).toEqual([
      expect.objectContaining({ event: 'approval.waiting', link: '/approvals' }),
    ]);
    const [request] = (await t.api.manager.get('/v1/approvals/inbox')).json().items;
    const decided = await t.api.manager.post(`/v1/approvals/${request.id}/decision`, {
      decision: 'approve',
      version: request.version,
    });
    expect(decided.statusCode).toBe(200);
    expect((await t.api.asha.get('/v1/notifications')).json().items).toContainEqual(
      expect.objectContaining({
        event: 'approval.decided',
        values: expect.objectContaining({ outcome: 'approved' }),
      }),
    );

    const importId = newId();
    await app.get(Database).forTenant(t.tenantId, (tx) =>
      app.get(Outbox).publish(tx, t.tenantId, 'import.finished', importId, {
        importId,
        userId: t.admin.id,
        target: 'users',
        fileName: 'people.csv',
        status: 'committed',
        created: 3,
        updated: 1,
      }),
    );
    expect((await t.api.admin.get('/v1/notifications')).json().items).toContainEqual(
      expect.objectContaining({ event: 'import.finished', link: `/imports/${importId}` }),
    );
    await deliverAll(t);
    expect(email().sent.filter((message) => message.to === t.admin.email)).toEqual([
      {
        to: t.admin.email,
        subject: 'Import done',
        text: expect.stringContaining('3 added, 1 changed'),
      },
    ]);
  });
});
