import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApprovalsService } from '../src/modules/workflow/approvals.service';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Leave (M13, BR-23, BR-27, decision D81). */

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

const DAY = 86_400_000;
const after = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
const TODAY = () => todayIn('Asia/Kolkata');
/** The first date on or after `date` falling on an ISO weekday. */
const next = (date: string, iso: number) => {
  let at = date;
  while (weekday(at) !== iso) at = after(at, 1);
  return at;
};

/** A tenant with its head (the admin), a manager, and a field user reporting to the manager. */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { head: newPhone(), manager: newPhone(), field: newPhone() };
  const head = await world.user(tenantId, {
    phone: phones.head,
    designation: 'head',
    role: 'tenant_admin',
  });
  const manager = await world.user(tenantId, {
    phone: phones.manager,
    designation: 'manager',
    managerId: head.id,
  });
  const field = await world.user(tenantId, {
    phone: phones.field,
    designation: 'executive',
    managerId: manager.id,
    joiningDate: '2020-01-01',
  });
  return {
    tenantId,
    fieldId: field.id,
    head: as((await world.signIn(phones.head)).accessToken),
    manager: as((await world.signIn(phones.manager)).accessToken),
    field: as((await world.signIn(phones.field, newDevice())).accessToken),
  };
}

const ask = (
  t: Awaited<ReturnType<typeof tenant>>,
  leaveType: string,
  startDate: string,
  endDate: string,
  extra: object = {},
) => t.field.post('/v1/leave-requests', { id: newId(), leaveType, startDate, endDate, ...extra });

/** Both steps of the template's leave chain: the manager, then the head. */
async function approve(
  t: Awaited<ReturnType<typeof tenant>>,
  approval: { id: string; version: number },
) {
  const first = await t.manager.post(`/v1/approvals/${approval.id}/decision`, {
    decision: 'approve',
    version: approval.version,
  });
  expect(first.statusCode, first.body).toBe(200);
  const last = await t.head.post(`/v1/approvals/${approval.id}/decision`, {
    decision: 'approve',
    version: first.json().version,
  });
  expect(last.json().status).toBe('approved');
}

describe('leave requests (BR-27)', () => {
  it('counts working days, keeps to the quota and refuses overlaps', async () => {
    const t = await tenant('Leave Co');
    const year = Number(TODAY().slice(0, 4)) + 1;
    // FX-20 on a real calendar: Friday to Monday, with Saturday a holiday and Sunday off.
    const friday = next(`${year}-03-01`, 5);
    const monday = after(friday, 3);
    expect(
      (
        await t.head.put(`/v1/calendars/standard/holidays/${after(friday, 1)}`, {
          name: 'Spring festival',
        })
      ).statusCode,
    ).toBe(200);
    const asked = await ask(t, 'casual', friday, monday, { reason: 'Family wedding' });
    expect(asked.statusCode, asked.body).toBe(201);
    expect(asked.json()).toMatchObject({
      leaveType: 'casual',
      days: 2,
      state: 'pending',
      approval: {
        requestType: 'leave',
        status: 'pending',
        subject: { title: `${friday} – ${monday}` },
      },
    });

    const overlap = await ask(t, 'unpaid', monday, monday);
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().error).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'startDate', issue: 'You have leave on some of these days already' }],
    });
    // Twelve working days in two weeks pass casual leave's 12 with the two asked for.
    const may = next(`${year}-05-01`, 1);
    const quota = await ask(t, 'casual', may, after(may, 13));
    expect(quota.statusCode).toBe(409);
    expect(quota.json().error).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      details: [{ path: 'leaveType', issue: 'This is more than the days left this year' }],
    });
    const half = await ask(t, 'casual', may, after(may, 1), { halfDay: true });
    expect(half.json().error.details).toEqual([
      { path: 'halfDay', issue: 'A half day is one day; make the first and last day the same' },
    ]);
    const sick = await ask(t, 'sick', may, after(may, 2));
    expect(sick.json().error.details).toEqual([
      { path: 'attachmentId', issue: 'Attach a document for leave this long' },
    ]);
    expect((await ask(t, 'nowhere', may, may)).json().error.details).toEqual([
      { path: 'leaveType', issue: 'There is no leave type with this key' },
    ]);
    const sunday = next(`${year}-06-01`, 7);
    expect((await ask(t, 'casual', sunday, sunday)).json().error.details).toEqual([
      { path: 'startDate', issue: 'These days are all weekly offs or holidays' },
    ]);
    // Without a quota, any number of days.
    expect((await ask(t, 'unpaid', may, after(may, 13))).statusCode).toBe(201);

    const balances = (await t.field.get(`/v1/leave-balances?on=${year}-03-01`)).json();
    expect(balances.items).toEqual([
      {
        leaveType: 'casual',
        from: `${year}-01-01`,
        to: `${year}-12-31`,
        quota: 12,
        approved: 0,
        pending: 2,
        available: 10,
      },
      {
        leaveType: 'sick',
        from: `${year}-01-01`,
        to: `${year}-12-31`,
        quota: 12,
        approved: 0,
        pending: 0,
        available: 12,
      },
      {
        leaveType: 'unpaid',
        from: `${year}-01-01`,
        to: `${year}-12-31`,
        quota: null,
        approved: 0,
        pending: 12,
        available: null,
      },
    ]);
    const listed = (
      await t.manager.get(`/v1/leave-requests?userId=${t.fieldId}&year=${year}`)
    ).json();
    expect(listed.items.map((item: { leaveType: string }) => item.leaveType)).toEqual([
      'casual',
      'unpaid',
    ]);
  });

  it('makes approved working days paid or unpaid leave, and frees withdrawn days', async () => {
    const t = await tenant('Approved Leave Co');
    const lastMonth = after(`${TODAY().slice(0, 7)}-01`, -1).slice(0, 7);
    const monday = next(`${lastMonth}-01`, 1);
    const tuesday = after(monday, 1);
    const thursday = after(monday, 3);

    const casual = await ask(t, 'casual', monday, tuesday);
    expect(casual.statusCode, casual.body).toBe(201);
    await approve(t, casual.json().approval);
    const unpaid = await ask(t, 'unpaid', thursday, thursday, { halfDay: true });
    await approve(t, unpaid.json().approval);

    const month = (
      await t.manager.get(`/v1/attendance?userId=${t.fieldId}&period=${lastMonth}`)
    ).json();
    const on = (date: string) => month.days.find((day: { date: string }) => day.date === date);
    expect(on(monday)).toMatchObject({ status: 'paid_leave', value: 1 });
    expect(on(tuesday)).toMatchObject({ status: 'paid_leave', value: 1 });
    expect(on(thursday)).toMatchObject({ status: 'unpaid_leave', value: 0 });
    expect(month.summary.paid).toBe(2);
    const stored = await world.database.forTenant(t.tenantId, (tx) =>
      tx.execute<{ date: string; status: string }>(
        `select date::text, status from cell.attendance_days where user_id = '${t.fieldId}' and date between '${monday}' and '${tuesday}' order by date`,
      ),
    );
    expect(stored.rows).toEqual([
      { date: monday, status: 'paid_leave' },
      { date: tuesday, status: 'paid_leave' },
    ]);
    const balance = (await t.field.get(`/v1/leave-balances?on=${monday}`)).json().items[0];
    expect(balance).toMatchObject({ leaveType: 'casual', approved: 2, pending: 0 });

    // Withdrawn before anyone decides, the request frees its days.
    const friday = after(monday, 4);
    const waiting = await ask(t, 'casual', friday, friday);
    const cancelled = await t.field.post(`/v1/approvals/${waiting.json().approval.id}/cancel`);
    expect(cancelled.json().status).toBe('cancelled');
    expect((await ask(t, 'casual', friday, friday)).statusCode).toBe(201);
    const listed = (await t.field.get(`/v1/leave-requests?year=${monday.slice(0, 4)}`)).json();
    expect(listed.items.map((item: { state: string }) => item.state)).toEqual([
      'approved',
      'approved',
      'cancelled',
      'pending',
    ]);

    // The leave register lists what touches the month.
    const register = (await t.head.get(`/v1/reports/leave_register?period=${lastMonth}`)).json();
    expect(register.rows.slice(0, 2)).toEqual([
      expect.objectContaining({
        leave_type: 'Casual leave',
        paid: true,
        start_date: monday,
        end_date: tuesday,
        days: 2,
        status: 'Approved',
      }),
      expect.objectContaining({ leave_type: 'Unpaid leave', half_day: true, days: 0.5 }),
    ]);
  });
});

describe('leave types (spec 5.10)', () => {
  it('keeps every type, switches one off, and refuses requests of it', async () => {
    const t = await tenant('Leave Types Co');
    const types = (await t.field.get('/v1/leave-types')).json().items;
    expect(types.map((type: { key: string }) => type.key)).toEqual(['casual', 'sick', 'unpaid']);

    const dropped = await t.head.put('/v1/leave-types', { items: types.slice(0, 2) });
    expect(dropped.json().error.details).toEqual([
      { path: 'items', issue: 'Keep unpaid; switch it off instead of removing it' },
    ]);
    const changed = await t.head.put('/v1/leave-types', {
      items: [
        { ...types[0], annualQuota: 15 },
        types[1],
        { ...types[2], active: false },
        {
          key: 'study',
          name: { en: 'Study leave', hi: 'अध्ययन अवकाश' },
          paid: true,
          annualQuota: 5,
          quotaYear: 'financial',
          halfDayAllowed: false,
        },
      ],
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(
      changed.json().items.map((type: { key: string; active: boolean }) => [type.key, type.active]),
    ).toEqual([
      ['casual', true],
      ['sick', true],
      ['unpaid', false],
      ['study', true],
    ]);
    const day = next(after(TODAY(), 7), 2);
    expect((await ask(t, 'unpaid', day, day)).json().error.details).toEqual([
      { path: 'leaveType', issue: 'This leave type is switched off' },
    ]);
    expect(
      (await t.field.get(`/v1/leave-balances?on=${day}`))
        .json()
        .items.map((item: { leaveType: string }) => item.leaveType),
    ).toEqual(['casual', 'sick', 'study']);
    expect((await t.manager.put('/v1/leave-types', { items: types })).json().error.code).toBe(
      'FORBIDDEN',
    );
  });
});

describe('leave and attendance switched off (M2, decision D83)', () => {
  const H = 3_600_000;

  it('keeps waiting requests out of the inbox, undecided and unreminded, until it is on again', async () => {
    const t = await tenant('Leave Off Co');
    const chains = (await t.head.get('/v1/workflows')).json().chains;
    const current = chains.find((entry: { requestType: string }) => entry.requestType === 'leave');
    expect(
      (
        await t.head.put('/v1/workflows/leave', {
          steps: [{ approver: { type: 'reporting_manager' }, reminderAfterHours: 24 }],
          version: current.version,
        })
      ).statusCode,
    ).toBe(200);
    const day = next(`${Number(TODAY().slice(0, 4)) + 1}-03-01`, 2);
    const asked = await ask(t, 'casual', day, day);
    expect(asked.statusCode, asked.body).toBe(201);
    const { id, version } = asked.json().approval;
    const inbox = () => t.manager.get('/v1/approvals/inbox').then((answer) => answer.json());
    expect(await inbox()).toMatchObject({ items: [{ id }], counts: { leave: 1 } });
    const keep = (hours: number) =>
      world.database.forTenant(t.tenantId, (tx) =>
        app.get(ApprovalsService).keepTime(tx, t.tenantId, new Date(Date.now() + hours * H)),
      );

    expect(
      (await t.head.patch('/v1/settings', { modulesOff: ['leave_attendance'] })).statusCode,
    ).toBe(200);
    expect(await inbox()).toEqual({ items: [], nextCursor: null, counts: {} });
    expect((await t.manager.get('/v1/approvals/inbox?requestType=leave')).json().items).toEqual([]);
    expect((await t.field.get('/v1/approvals/mine')).json().items).toEqual([]);
    const code = (answer: { json(): { error?: { code: string } } }) => answer.json().error?.code;
    expect(code(await t.manager.get(`/v1/approvals/${id}`))).toBe('MODULE_DISABLED');
    expect(
      code(await t.manager.post(`/v1/approvals/${id}/decision`, { decision: 'approve', version })),
    ).toBe('MODULE_DISABLED');
    const bulk = await t.manager.post('/v1/approvals/decisions', { items: [{ id, version }] });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json().results).toEqual([
      expect.objectContaining({
        id,
        approval: null,
        error: expect.objectContaining({ code: 'MODULE_DISABLED' }),
      }),
    ]);
    expect(code(await t.field.post(`/v1/approvals/${id}/cancel`))).toBe('MODULE_DISABLED');
    expect(await keep(25)).toBe(0);

    // Switched on again, the request waits where it was, and its reminder follows.
    expect((await t.head.patch('/v1/settings', { modulesOff: [] })).statusCode).toBe(200);
    expect(await inbox()).toMatchObject({ items: [{ id, version }], counts: { leave: 1 } });
    expect((await t.field.get('/v1/approvals/mine')).json().items).toEqual([
      expect.objectContaining({ id }),
    ]);
    expect(await keep(25)).toBe(1);
    const decided = await t.manager.post('/v1/approvals/decisions', { items: [{ id, version }] });
    expect(decided.json().results[0]).toMatchObject({
      id,
      error: null,
      approval: { status: 'approved' },
    });
  });
});
